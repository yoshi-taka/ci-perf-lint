import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { parseSemverLikeVersionSpec } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { detectInstalledMypyVersion } from "./mypy-version.ts";

const meta = {
  id: "prefer-mypy-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-mypy-performance-milestone.md",
} satisfies RuleMeta;

function getNextMypyPerformanceMilestone(version: {
  major?: number;
  minor?: number;
  patch?: number;
}): { target: string; why: string } | undefined {
  const { major, minor, patch } = version;
  if (major !== 1 || minor === undefined) {
    return undefined;
  }

  if (minor < 13) {
    return {
      target: "1.13",
      why: "mypy 1.13 includes performance improvements in type-checking speed.",
    };
  }

  if (minor < 15) {
    return {
      target: "1.15",
      why: "mypy 1.15 includes further performance improvements in type-checking speed.",
    };
  }

  if (minor === 18 && (patch === undefined || patch <= 0)) {
    return {
      target: "1.18.1",
      why: "mypy 1.18.1 includes performance improvements in type-checking speed.",
    };
  }

  return undefined;
}

export async function collectMypyMilestoneDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];

  const detected = await detectInstalledMypyVersion(context);
  if (!detected) {
    return diagnostics;
  }

  const parsed = parseSemverLikeVersionSpec(detected.version);
  const milestone = getNextMypyPerformanceMilestone(parsed);
  if (milestone) {
    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: detected.fileName,
          line: detected.line + 1,
          column: 1,
        },
        message: `Repository is on mypy ${detected.version}, below the ${milestone.target} speed milestone.`,
        why: milestone.why,
        suggestion: `If upgrading is feasible, move mypy from ${detected.version} to at least ${milestone.target} as the next speed milestone.`,
        measurementHint: "Compare type-check times before and after upgrading mypy.",
        aiHandoff: `Review ${detected.fileName} and upgrade mypy from ${detected.version} to at least ${milestone.target}.`,
        score: 45,
      }),
    );
  }

  return diagnostics;
}
