import type { Diagnostic, RuleMeta, SourceLocation, AnalysisWarning } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  collectDockerfileInstructions,
  parseDockerfileFromInstruction,
} from "./dockerfile-instructions.ts";
import {
  checkElixirVersion,
  checkOtpVersion,
  parseOtpVersion,
} from "../rules/shared/elixir-versions.ts";

const meta = {
  id: "elixir-otp-version-performance",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/elixir-otp-version-performance.md",
} satisfies RuleMeta;

interface VersionSource {
  otpVersion?: string;
  elixirVersion?: string;
  location: SourceLocation;
}

async function collectToolVersionsSource(
  scanContext: RepositoryScanContext,
): Promise<VersionSource | undefined> {
  const toolVersionsPath = scanContext.resolve(".tool-versions");
  if (!(await scanContext.pathExists(toolVersionsPath))) {
    return undefined;
  }

  const text = await scanContext.readTextFileOrWarn(toolVersionsPath);
  if (!text) {
    return undefined;
  }

  const lines = text.split("\n");
  let otpVersion: string | undefined;
  let elixirVersion: string | undefined;
  let otpLine = 1;
  let elixirLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? "";
    const erlangMatch = trimmed.match(/^erlang\s+(\S+)/);
    if (erlangMatch) {
      otpVersion = erlangMatch[1];
      otpLine = i + 1;
      continue;
    }
    const elixirMatch = trimmed.match(/^elixir\s+(\S+)/);
    if (elixirMatch) {
      elixirVersion = elixirMatch[1];
      elixirLine = i + 1;
    }
  }

  if (!otpVersion && !elixirVersion) {
    return undefined;
  }

  return {
    otpVersion,
    elixirVersion,
    location: {
      path: ".tool-versions",
      line: otpVersion ? otpLine : elixirLine,
      column: 1,
    },
  };
}

async function collectDockerfileSources(
  repoRoot: string,
  scanContext: RepositoryScanContext,
): Promise<VersionSource[]> {
  const dockerfiles: string[] = [];
  for await (const relativePath of scanContext.walkFilesIter(".", {
    include: (candidatePath: string) => {
      const lower = candidatePath.toLowerCase();
      return (
        lower === "dockerfile" || lower.endsWith(".dockerfile") || lower.endsWith("/dockerfile")
      );
    },
    ignoredDirectories: new Set([".git", "node_modules"]),
  })) {
    dockerfiles.push(relativePath);
  }

  const sources: VersionSource[] = [];

  for (const relativePath of dockerfiles) {
    const fullPath = scanContext.resolve(relativePath);
    const text = await scanContext.readTextFileOrWarn(fullPath);
    if (!text) {
      continue;
    }

    const instructions = collectDockerfileInstructions(text.split("\n"));
    for (const instruction of instructions) {
      const parsed = parseDockerfileFromInstruction(instruction);
      if (!parsed) {
        continue;
      }

      const image = parsed.image.toLowerCase();
      if (!image.startsWith("elixir:")) {
        continue;
      }

      const elixirVersion = image.replace(/^elixir:/, "");
      const otpFromImage = elixirVersion.match(/otp[-.]?(\d+)/i)?.[1];

      sources.push({
        otpVersion: otpFromImage,
        elixirVersion,
        location: {
          path: relativePath,
          line: instruction.startLine,
          column: 1,
        },
      });
    }
  }

  return sources;
}

export async function collectElixirOtpVersionDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  _warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, _warnings ?? []);
  const findings: Diagnostic[] = [];

  const dockerfileSources = await collectDockerfileSources(repoRoot, context);
  const toolVersionsSource = await collectToolVersionsSource(context);

  for (const source of dockerfileSources) {
    if (source.otpVersion) {
      const otp = parseOtpVersion(source.otpVersion);
      if (otp !== undefined) {
        const finding = checkOtpVersion(otp);
        if (finding) {
          findings.push(
            buildRepositoryDiagnostic(repository, meta, {
              ...finding,
              location: source.location,
              measurementHint: "Check the elixir version used in your CI pipeline.",
              aiHandoff: `Review ${source.location.path}:${source.location.line} for OTP version.`,
              score: 58,
            }),
          );
        }
      }
    }

    if (source.elixirVersion) {
      const finding = checkElixirVersion(source.elixirVersion);
      if (finding) {
        findings.push(
          buildRepositoryDiagnostic(repository, meta, {
            ...finding,
            location: source.location,
            measurementHint: "Check the elixir version used in your CI pipeline.",
            aiHandoff: `Review ${source.location.path}:${source.location.line} for Elixir version.`,
            score: 58,
          }),
        );
      }
    }
  }

  if (toolVersionsSource) {
    if (toolVersionsSource.otpVersion) {
      const otp = parseOtpVersion(toolVersionsSource.otpVersion);
      if (otp !== undefined) {
        const finding = checkOtpVersion(otp);
        if (finding) {
          findings.push(
            buildRepositoryDiagnostic(repository, meta, {
              ...finding,
              location: toolVersionsSource.location,
              measurementHint: "Check the erlang version in .tool-versions.",
              aiHandoff: "Review .tool-versions for OTP version.",
              score: 48,
            }),
          );
        }
      }
    }

    if (toolVersionsSource.elixirVersion) {
      const finding = checkElixirVersion(toolVersionsSource.elixirVersion);
      if (finding) {
        findings.push(
          buildRepositoryDiagnostic(repository, meta, {
            ...finding,
            location: {
              ...toolVersionsSource.location,
              line: toolVersionsSource.location.line,
            },
            measurementHint: "Check the elixir version in .tool-versions.",
            aiHandoff: "Review .tool-versions for Elixir version.",
            score: 48,
          }),
        );
      }
    }
  }

  return findings;
}
