import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-nextjs-12-minor-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-nextjs-12-minor-performance-milestone.md",
} satisfies RuleMeta;

function milestoneWhy(currentMinor: number): string {
  if (currentMinor <= 0) {
    return "Next.js 12.0 is below the 12.3 build-performance milestone. The 12.1 and 12.2 lines added more SWC compiler coverage, SWC minification work, on-demand ISR stabilization, and standalone output improvements, while 12.3 made SWC minification stable and continued image and compiler stabilization.";
  }

  if (currentMinor === 1) {
    return "Next.js 12.1 already has early SWC minification and compiler stabilization work, but it is still below the 12.2 and 12.3 CI-relevant milestones. Next.js 12.2 stabilized on-demand ISR and improved the compiler path, while 12.3 made SWC minification stable and continued image and compiler stabilization.";
  }

  return "Next.js 12.2 is close, but 12.3 is the stronger 12.x CI target because it makes SWC minification stable and includes additional image and compiler stabilization without requiring a major-version jump.";
}

export function collectPreferNextjs12MinorPerformanceMilestoneDiagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
): Diagnostic[] {
  const { nextjsVersionSpec, nextjsMajor, nextjsMinor } = repository.frameworks;
  if (!nextjsVersionSpec || nextjsMajor !== 12 || nextjsMinor === undefined || nextjsMinor >= 3) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: "package.json", line: 1, column: 1 },
      message: `The repository is on Next.js ${nextjsVersionSpec}, below the 12.3 build-performance milestone.`,
      why: milestoneWhy(nextjsMinor),
      suggestion: `If a major-version upgrade is not feasible yet, move Next.js from ${nextjsVersionSpec} to at least 12.3.x as the next low-risk 12.x CI performance target.`,
      measurementHint:
        "Compare `next build` wall-clock time, minification time, generated JavaScript size, and image-related build warnings before and after upgrading to Next.js 12.3.x.",
      aiHandoff: `Review the repository Next.js version. If compatibility allows, upgrade Next.js from ${nextjsVersionSpec} to at least 12.3.x before considering a later major-version migration.`,
      score: nextjsMinor === 2 ? 51 : 49,
    }),
  ];
}
