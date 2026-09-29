import type { AnalysisWarning, Diagnostic, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  preferModernUvVersionMeasurementHint,
  preferModernUvVersionMeta as meta,
  preferModernUvVersionSuggestion,
  uvVersionSpecIsBelowModern,
} from "../rules/shared/uv-versions.ts";

const configFileNames = ["pyproject.toml", "uv.toml", ".uv-version"] as const;

const requiredVersionPattern = /required-version\s*=\s*["']([^"']+)["']/i;
const quotedUvRequirementPattern = /["'](uv(?:_build)?)\s*([<>=!~^][^"']*)["']/gi;
const bareUvVersionPattern = /v?(\d+\.\d+(?:\.\d+)?)/;

function locationFromIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function detectOutdatedSpec(
  fileName: string,
  text: string,
): { spec: string; location: { line: number; column: number } } | undefined {
  if (fileName === ".uv-version") {
    const match = bareUvVersionPattern.exec(text.trim());
    if (match && uvVersionSpecIsBelowModern(match[1])) {
      return { spec: match[1]!, location: { line: 1, column: 1 } };
    }
    return undefined;
  }

  const required = requiredVersionPattern.exec(text);
  if (required?.[1] && uvVersionSpecIsBelowModern(required[1])) {
    return { spec: required[1], location: locationFromIndex(text, required.index) };
  }

  quotedUvRequirementPattern.lastIndex = 0;
  let requirement: RegExpExecArray | null;
  while ((requirement = quotedUvRequirementPattern.exec(text))) {
    const spec = requirement[2]!;
    if (uvVersionSpecIsBelowModern(spec)) {
      return {
        spec: `${requirement[1]!}${spec}`,
        location: locationFromIndex(text, requirement.index),
      };
    }
  }

  return undefined;
}

export async function collectPreferModernUvVersionDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  for (const fileName of configFileNames) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }

    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }

    const detected = detectOutdatedSpec(fileName, text);
    if (!detected) {
      continue;
    }

    const location: SourceLocation = { path: fileName, ...detected.location };
    return [
      buildRepositoryDiagnostic(repository, meta, {
        location,
        message: `The repository pins uv ${detected.spec} in ${fileName}, below 0.10.`,
        why: "uv 0.10 stabilized Python version management and carried a batch of correctness and performance fixes. Keeping uv below 0.10 leaves CI on the slower resolver and misses the stabilized upgrade paths that reduce repeated resolution and install work.",
        suggestion: preferModernUvVersionSuggestion,
        measurementHint: preferModernUvVersionMeasurementHint,
        aiHandoff: `Review ${fileName} at ${location.line}:${location.column} and raise the uv constraint to at least 0.10.x. Keep the rest of the configuration unchanged and re-run the CI job to confirm dependency resolution is unchanged.`,
        score: 50,
      }),
    ];
  }

  return [];
}
