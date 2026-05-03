import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { WorkflowDocument } from "../workflow.ts";

const meta = {
  id: "avoid-mypy-production-bundle",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-mypy-production-bundle.md",
} satisfies RuleMeta;

interface MatchResult {
  line: number;
  column: number;
  section?: string;
}

function isProductionPyprojectSection(section: string): boolean {
  return (
    section === "project.dependencies" ||
    section === "project.optional-dependencies" ||
    section.startsWith("project.optional-dependencies.") ||
    section === "tool.poetry.dependencies" ||
    section === "tool.poetry.extras" ||
    section.startsWith("tool.poetry.extras.")
  );
}

function checkPyprojectToml(text: string): MatchResult | undefined {
  const lines = text.split("\n");
  let currentSection = "";
  let inProjectDepsArray = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      inProjectDepsArray = false;
      continue;
    }

    if (
      currentSection === "project" &&
      /^(dependencies|optional-dependencies)\s*=\s*\[/.test(trimmed)
    ) {
      inProjectDepsArray = true;
      if (/\bmypy\b/.test(line)) {
        return { line: i, column: line.indexOf("mypy") + 1, section: "project" };
      }
      continue;
    }

    if (inProjectDepsArray) {
      if (trimmed === "]") {
        inProjectDepsArray = false;
        continue;
      }
      if (/\bmypy\b/.test(line)) {
        return { line: i, column: line.indexOf("mypy") + 1, section: "project" };
      }
    }

    if (isProductionPyprojectSection(currentSection) && /\bmypy\b/.test(line)) {
      const col = line.indexOf("mypy");
      return { line: i, column: col + 1, section: currentSection };
    }
  }
  return undefined;
}

function checkRequirementsTxt(text: string): MatchResult | undefined {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("-")) {
      continue;
    }
    if (/\bmypy\b/.test(line)) {
      return { line: i, column: line.indexOf("mypy") + 1 };
    }
  }
  return undefined;
}

function checkSetupPy(text: string): MatchResult | undefined {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/install_requires\s*=/.test(line) && /\bmypy\b/.test(line)) {
      return { line: i, column: line.indexOf("mypy") + 1 };
    }
  }
  return undefined;
}

function checkSetupCfg(text: string): MatchResult | undefined {
  const lines = text.split("\n");
  let inOptions = false;
  let inInstallRequires = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "[options]") {
      inOptions = true;
      inInstallRequires = false;
      continue;
    }
    if (trimmed.startsWith("[")) {
      inOptions = false;
      inInstallRequires = false;
      continue;
    }
    if (inOptions && /^install_requires\b/.test(trimmed)) {
      inInstallRequires = true;
      if (/\bmypy\b/.test(line)) {
        return { line: i, column: line.indexOf("mypy") + 1, section: "options" };
      }
      continue;
    }
    if (inInstallRequires && trimmed.length === 0) {
      inInstallRequires = false;
      continue;
    }
    if (inInstallRequires && /\bmypy\b/.test(line)) {
      return { line: i, column: line.indexOf("mypy") + 1, section: "options" };
    }
  }
  return undefined;
}

function checkPipfile(text: string): MatchResult | undefined {
  const lines = text.split("\n");
  let inPackages = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "[packages]") {
      inPackages = true;
      continue;
    }
    if (trimmed.startsWith("[")) {
      inPackages = false;
      continue;
    }
    if (inPackages && /\bmypy\b/.test(line)) {
      return { line: i, column: line.indexOf("mypy") + 1, section: "packages" };
    }
  }
  return undefined;
}

async function checkCdkAssets(
  context: RepositoryScanContext,
): Promise<{ assetPath: string; exampleFile: string }[]> {
  const manifestPath = context.resolve("cdk.out/manifest.json");
  const manifestText = await context.readTextFileOrWarn(manifestPath);
  if (!manifestText) {
    return [];
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return [];
  }

  const artifacts = manifest.artifacts as Record<string, Record<string, unknown>> | undefined;
  if (!artifacts) {
    return [];
  }

  const results: { assetPath: string; exampleFile: string }[] = [];

  for (const artifact of Object.values(artifacts)) {
    const type = artifact.type as string | undefined;
    if (type !== "aws:cdk:asset") {
      continue;
    }

    const assetPath = artifact.path as string | undefined;
    if (!assetPath) {
      continue;
    }

    let found = false;
    let exampleFile = "";

    try {
      for await (const relativePath of context.walkFilesIter(`cdk.out/${assetPath}`, {
        ignoredDirectories: new Set([".git", "node_modules"]),
      })) {
        const parts = relativePath.split("/");
        if (
          parts.some(
            (p) => p === "mypy" || p === "mypy_extensions" || /^mypy-[\d.]+\.dist-info$/.test(p),
          )
        ) {
          found = true;
          exampleFile = relativePath;
          break;
        }
      }
    } catch {
      continue;
    }

    if (found) {
      results.push({ assetPath: `cdk.out/${assetPath}`, exampleFile });
    }
  }

  return results;
}

export async function collectAvoidMypyProductionBundleDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];

  const checks: {
    fileName: string;
    check: (text: string) => MatchResult | undefined;
  }[] = [
    { fileName: "pyproject.toml", check: checkPyprojectToml },
    { fileName: "requirements.txt", check: checkRequirementsTxt },
    { fileName: "setup.py", check: checkSetupPy },
    { fileName: "setup.cfg", check: checkSetupCfg },
    { fileName: "Pipfile", check: checkPipfile },
  ];

  for (const { fileName, check } of checks) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }

    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }

    const result = check(text);
    if (result) {
      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: {
            path: fileName,
            line: result.line + 1,
            column: result.column,
          },
          message: result.section
            ? `mypy is declared in a production dependency section (${result.section}) in ${fileName}.`
            : `mypy is declared in ${fileName}, which appears to be a production dependency file.`,
          why: "mypy is a type checker and development tool. Including it in production dependencies increases bundle size, installation time, and attack surface without providing runtime value.",
          suggestion:
            "Move mypy to a development dependency group (for example, dev-dependencies, dev-packages, or dependency-groups.dev).",
          measurementHint:
            "Compare bundle size or dependency install time before and after moving mypy to dev dependencies.",
          aiHandoff: `Review ${fileName} and move mypy from the production dependency section to the appropriate development dependency section. Do not change any other dependencies.`,
          score: 60,
        }),
      );
      break;
    }
  }

  const cdkResults = await checkCdkAssets(context);
  for (const cdkResult of cdkResults) {
    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: "cdk.out/manifest.json",
          line: 1,
          column: 1,
        },
        message: `CDK asset at ${cdkResult.assetPath} contains mypy package files (for example, ${cdkResult.exampleFile}).`,
        why: "CDK assets are deployed to AWS as-is. Bundling mypy (a development-only type checker) into production assets inflates deployment package size and Lambda cold-start latency.",
        suggestion:
          "Configure CDK bundling to exclude development dependencies, or add mypy to the bundling exclusion list.",
        measurementHint:
          "Compare CDK asset size and deployment time before and after excluding mypy from the bundle.",
        aiHandoff: `Review the CDK bundling configuration for the asset containing ${cdkResult.exampleFile}. Exclude mypy and other development-only packages from production bundles.`,
        score: 70,
      }),
    );
  }

  return diagnostics;
}
