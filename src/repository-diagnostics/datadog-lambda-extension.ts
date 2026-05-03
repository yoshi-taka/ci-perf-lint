import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { packageJsonHasDependency } from "../repository-package-helpers.ts";
import {
  collectDockerBuildTargets,
  collectDockerfileData,
  normalizeRelativePath,
} from "./docker-build-targets.ts";
import { parseDockerfileFromInstruction } from "./dockerfile-instructions.ts";

const DD_EXTENSION_IMAGE_PATTERN =
  /^public\.ecr\.aws\/datadog\/lambda-extension[:\s]*(?:v)?(\d+)$/i;
const DD_LAYER_ARN_PATTERN = /Datadog-Extension[:\s]*(\d+)/i;
const DD_EXTENSION_VERSION_KEY = /extension(?:Layer)?Version[:\s]*(\d+)/i;
const DD_PACKAGES = [
  "datadog-cdk-constructs-v2",
  "datadog-cdk-constructs",
  "serverless-plugin-datadog",
  "dd-trace",
  "@datadog/dd-trace",
];
const MINIMUM_MAJOR = 88;

const meta = {
  id: "outdated-datadog-lambda-extension",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/outdated-datadog-lambda-extension.md",
} satisfies RuleMeta;

async function hasDatadogPackage(context: RepositoryScanContext): Promise<boolean> {
  const packageJsonEntry = await context.loadPackageJson();
  const pkg = packageJsonEntry.value;
  if (!pkg) {
    return false;
  }
  return DD_PACKAGES.some((dep) => packageJsonHasDependency(pkg, dep));
}

async function scanConfigFilesForExtensionVersion(
  context: RepositoryScanContext,
  repoRoot: string,
  diagnostics: Diagnostic[],
  repository: RepositorySignals,
): Promise<void> {
  const usesDatadogPackage = await hasDatadogPackage(context);

  const SOURCE_FILE_PATTERNS = [/\.ts$/, /\.tsx$/, /\.py$/];
  const CONFIG_FILE_PATTERNS = [/\.tf$/, /\.tfvars$/, /serverless\.ya?ml$/, /\.json$/];
  const allPatterns = usesDatadogPackage
    ? [...CONFIG_FILE_PATTERNS, ...SOURCE_FILE_PATTERNS]
    : CONFIG_FILE_PATTERNS;

  const configFiles: string[] = [];
  for await (const relativePath of context.walkFilesIter(".", {
    ignoredDirectories: new Set([
      ".git",
      "node_modules",
      ".terraform",
      "vendor",
      "dist",
      "build",
      "fixtures",
    ]),
    include: (candidatePath) => allPatterns.some((pattern) => pattern.test(candidatePath)),
  })) {
    configFiles.push(relativePath);
  }

  for (const relativePath of configFiles) {
    const absolutePath = context.resolve(relativePath);
    const text = await context.readTextFileOrWarn(absolutePath);
    if (!text) {
      continue;
    }

    let lineNum = 0;
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      lineNum += 1;

      if (!/Datadog-Extension|datadog.*extension|extension.*layer.*version/i.test(line)) {
        continue;
      }

      const arnMatch = line.match(DD_LAYER_ARN_PATTERN);
      if (arnMatch) {
        const version = parseInt(arnMatch[1] ?? "0", 10);
        if (version >= MINIMUM_MAJOR) {
          continue;
        }

        diagnostics.push(
          buildRepositoryDiagnostic(
            repository,
            { ...meta, confidence: "high" },
            {
              location: { path: relativePath, line: lineNum, column: 1 },
              message: `Datadog Lambda Extension v${version} is on the old Go-based compatibility track. v${MINIMUM_MAJOR} and later ship only the Rust-based Next Generation Extension.`,
              why: "v87 was the last release to bundle the legacy Go Agent for compatibility mode. Starting with v88, the extension contains only the Rust-based Next Generation Extension (Bottlecap), which reduces cold-start latency and memory overhead. The extension layer size drops by roughly 50% compared to earlier versions.",
              suggestion: `Upgrade to v${MINIMUM_MAJOR} or later by updating the layer version in the ARN (for example, \`arn:aws:lambda:<region>:464622532012:layer:Datadog-Extension:${MINIMUM_MAJOR}\`).`,
              measurementHint:
                "After upgrading, verify the extension version in the Datadog Web UI under Lambda > Extensions.",
              aiHandoff: `Review ${relativePath}:${lineNum} and update the Datadog Lambda Extension layer ARN to version ${MINIMUM_MAJOR} or higher.`,
              score: 80,
            },
          ),
        );
        continue;
      }

      const keyMatch = line.match(DD_EXTENSION_VERSION_KEY);
      if (keyMatch) {
        const version = parseInt(keyMatch[1] ?? "0", 10);
        if (version >= MINIMUM_MAJOR) {
          continue;
        }

        diagnostics.push(
          buildRepositoryDiagnostic(
            repository,
            { ...meta, confidence: usesDatadogPackage ? "high" : "medium" },
            {
              location: { path: relativePath, line: lineNum, column: 1 },
              message: `Datadog Lambda Extension v${version} is on the old Go-based compatibility track. v${MINIMUM_MAJOR} and later ship only the Rust-based Next Generation Extension.`,
              why: "v87 was the last release to bundle the legacy Go Agent for compatibility mode. Starting with v88, the extension contains only the Rust-based Next Generation Extension (Bottlecap), which reduces cold-start latency and memory overhead. The extension layer size drops by roughly 50% compared to earlier versions.",
              suggestion: `Upgrade to v${MINIMUM_MAJOR} or later by updating extensionLayerVersion.`,
              measurementHint:
                "After upgrading, verify the extension version in the Datadog Web UI under Lambda > Extensions.",
              aiHandoff: `Review ${relativePath}:${lineNum} and update extensionLayerVersion to ${MINIMUM_MAJOR} or higher.`,
              score: 75,
            },
          ),
        );
      }
    }
  }
}

async function scanCdkManifestAndTemplates(
  context: RepositoryScanContext,
  repoRoot: string,
  diagnostics: Diagnostic[],
  repository: RepositorySignals,
): Promise<void> {
  const manifestPath = context.resolve("cdk.out/manifest.json");
  const manifestText = await context.readTextFileOrWarn(manifestPath);
  if (!manifestText) {
    return;
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return;
  }

  const artifacts = manifest.artifacts as Record<string, Record<string, unknown>> | undefined;
  if (!artifacts) {
    return;
  }

  const templateFiles: string[] = [];
  for (const artifact of Object.values(artifacts)) {
    const type = artifact.type as string | undefined;
    if (type !== "aws:cloudformation:stack") {
      continue;
    }
    const props = artifact.properties as Record<string, unknown> | undefined;
    const templateFile = props?.templateFile as string | undefined;
    if (!templateFile) {
      continue;
    }
    templateFiles.push(templateFile);
  }

  for (const templateFile of templateFiles) {
    const relativePath = `cdk.out/${templateFile}`;
    const absolutePath = context.resolve(relativePath);
    const text = await context.readTextFileOrWarn(absolutePath);
    if (!text) {
      continue;
    }

    let lineNum = 0;
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      lineNum += 1;

      const arnMatch = line.match(DD_LAYER_ARN_PATTERN);
      if (!arnMatch) {
        continue;
      }

      const version = parseInt(arnMatch[1] ?? "0", 10);
      if (version >= MINIMUM_MAJOR) {
        continue;
      }

      diagnostics.push(
        buildRepositoryDiagnostic(
          repository,
          { ...meta, confidence: "high" },
          {
            location: { path: relativePath, line: lineNum, column: 1 },
            message: `Datadog Lambda Extension v${version} (resolved) is on the old Go-based compatibility track. v${MINIMUM_MAJOR} and later ship only the Rust-based Next Generation Extension.`,
            why: "v87 was the last release to bundle the legacy Go Agent for compatibility mode. Starting with v88, the extension contains only the Rust-based Next Generation Extension (Bottlecap), which reduces cold-start latency and memory overhead. The extension layer size drops by roughly 50% compared to earlier versions.",
            suggestion: `Update the extension version to ${MINIMUM_MAJOR} or later in the CDK source, then re-synth to verify.`,
            measurementHint:
              "After upgrading, verify the extension version in the Datadog Web UI (Serverless View or Lambda function details).",
            aiHandoff: `Review ${relativePath}:${lineNum} and update the Datadog Lambda Extension version in the CDK source (likely extensionVersion or extensionLayerVersion).`,
            score: 75,
          },
        ),
      );
      break;
    }
  }
}

export async function collectDatadogLambdaExtensionDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];

  const targets = await collectDockerBuildTargets(repoRoot, workflows, warnings, scanContext);
  const seenDockerfiles = new Set<string>();

  for (const target of targets) {
    if (seenDockerfiles.has(target.dockerfilePath)) {
      continue;
    }
    seenDockerfiles.add(target.dockerfilePath);

    const dockerfileData = await collectDockerfileData(context, target.dockerfilePath);
    if (!dockerfileData) {
      continue;
    }

    for (const instruction of dockerfileData.instructions) {
      const fromInst = parseDockerfileFromInstruction(instruction);
      if (!fromInst) {
        continue;
      }

      const match = fromInst.image.match(DD_EXTENSION_IMAGE_PATTERN);
      if (!match) {
        continue;
      }

      const version = parseInt(match[1] ?? "0", 10);
      if (version >= MINIMUM_MAJOR) {
        continue;
      }

      const dockerfileRelativePath = normalizeRelativePath(repoRoot, target.dockerfilePath);
      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: {
            path: dockerfileRelativePath,
            line: instruction.startLine,
            column: 1,
          },
          message: `Datadog Lambda Extension v${version} is on the old Go-based compatibility track. v${MINIMUM_MAJOR} and later ship only the Rust-based Next Generation Extension.`,
          why: "v87 was the last release to bundle the legacy Go Agent for compatibility mode. Starting with v88, the extension contains only the Rust-based Next Generation Extension (Bottlecap), which reduces cold-start latency and memory overhead. The extension layer size drops by roughly 50% compared to earlier versions.",
          suggestion: `Upgrade to v${MINIMUM_MAJOR} or later by updating the image tag in the Dockerfile FROM instruction (for example, \`public.ecr.aws/datadog/lambda-extension:${MINIMUM_MAJOR}\`).`,
          measurementHint:
            "After upgrading, verify the extension version in the Datadog Web UI (Serverless View or Lambda function details).",
          aiHandoff: `Review ${dockerfileRelativePath} and update \`${fromInst.image}\` to target \`public.ecr.aws/datadog/lambda-extension:${MINIMUM_MAJOR}\` or higher.`,
          score: 80,
        }),
      );
    }
  }

  await scanConfigFilesForExtensionVersion(context, repoRoot, diagnostics, repository);

  if (await hasDatadogPackage(context)) {
    await scanCdkManifestAndTemplates(context, repoRoot, diagnostics, repository);
  }

  return diagnostics;
}
