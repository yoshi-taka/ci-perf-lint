import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { parseSemverLikeVersionSpec } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { detectInstalledMypyVersion } from "./mypy-version.ts";

const meta = {
  id: "prefer-mypy-2-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-mypy-2-performance-milestone.md",
} satisfies RuleMeta;

function getNextMypy2PerformanceMilestone(version: {
  major?: number;
  minor?: number;
}): { target: string; why: string } | undefined {
  const { major, minor } = version;
  if (major !== 2 || minor === undefined) {
    return undefined;
  }

  if (minor < 2) {
    return {
      target: "2.2",
      why: "mypy 2.2 includes internal performance improvements such as a memoized options snapshot, faster transitive dependency hashing for singleton SCCs, and optimized TypeForm checks.",
    };
  }

  if (minor < 4) {
    return {
      target: "2.4",
      why: "mypy 2.4 enables the native Rust parser by default (significantly faster parsing), makes parallel type checking non-experimental with automatic worker selection (up to 5x with 8 workers), and speeds up generators and coroutines.",
    };
  }

  return undefined;
}

export async function collectMypy2MilestoneDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  const detected = await detectInstalledMypyVersion(context);
  if (!detected) {
    return [];
  }

  const parsed = parseSemverLikeVersionSpec(detected.version);
  const milestone = getNextMypy2PerformanceMilestone(parsed);
  if (!milestone) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: detected.fileName,
        line: detected.line + 1,
        column: 1,
      },
      message: `Repository is on mypy ${detected.version}, below the ${milestone.target} speed milestone.`,
      why: milestone.why,
      suggestion: `If upgrading is feasible, move mypy from ${detected.version} to at least ${milestone.target} as the next speed milestone.`,
      measurementHint:
        "Compare type-check times before and after upgrading, and with and without --num-workers.",
      aiHandoff: `Review ${detected.fileName} and upgrade mypy from ${detected.version} to at least ${milestone.target}. Validate the CI type-check job afterward.`,
      score: 40,
    }),
  ];
}
