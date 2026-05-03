import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-nextjs-14-minor-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-nextjs-14-minor-performance-milestone.md",
} satisfies RuleMeta;

export function collectPreferNextjs14MinorPerformanceMilestoneDiagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
): Diagnostic[] {
  const { nextjsVersionSpec, nextjsMajor, nextjsMinor } = repository.frameworks;
  if (!nextjsVersionSpec || nextjsMajor !== 14 || nextjsMinor === undefined || nextjsMinor >= 2) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: "package.json", line: 1, column: 1 },
      message: `The repository is on Next.js ${nextjsVersionSpec}, below the 14.2 build-performance milestone.`,
      why: "Next.js 14.2 is the main 14.x CI/build milestone: it explicitly targets lower build memory usage, CSS optimizations, and production and caching improvements. Those map directly to common CI pain points such as memory-heavy builds and slow CSS processing.",
      suggestion: `If a major-version upgrade is not feasible yet, move Next.js from ${nextjsVersionSpec} to at least 14.2.x as the highest-value 14.x CI build target.`,
      measurementHint:
        "Compare `next build` wall-clock time, peak memory usage, CSS processing time, and production cache behavior before and after upgrading to Next.js 14.2.x.",
      aiHandoff: `Review the repository Next.js version. If compatibility allows, upgrade Next.js from ${nextjsVersionSpec} to at least 14.2.x, then compare build time, peak memory, CSS processing, and cache behavior.`,
      score: 54,
    }),
  ];
}
