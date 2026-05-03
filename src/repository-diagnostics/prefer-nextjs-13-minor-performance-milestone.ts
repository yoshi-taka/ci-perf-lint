import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-nextjs-13-minor-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-nextjs-13-minor-performance-milestone.md",
} satisfies RuleMeta;

function milestoneWhy(currentMinor: number): string {
  if (currentMinor <= 0) {
    return "Next.js 13.0 is below the 13.3 build-performance milestone. The 13.1 line brought built-in module transpilation, SWC import-resolution, memory, HMR, and chunking improvements; 13.2 added the Next.js Cache beta and Rust MDX parser; and 13.3 added static export support for the App Router plus metadata and routing features that can matter for static-heavy builds.";
  }

  if (currentMinor === 1) {
    return "Next.js 13.1 has the first CI-relevant 13.x improvements, including built-in module transpilation and SWC import-resolution work, but it is still below the 13.2 and 13.3 build milestones. Next.js 13.2 added the Next.js Cache beta and Rust MDX parser, while 13.3 added App Router static export support and related routing and metadata features.";
  }

  return "Next.js 13.2 includes cache and Rust MDX work, but 13.3 is the stronger generic CI target for 13.x static-heavy repositories because it adds App Router static export support plus metadata and routing features. Next.js 13.4 is more of an App Router stability line than a generic build-performance target.";
}

export function collectPreferNextjs13MinorPerformanceMilestoneDiagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
): Diagnostic[] {
  const { nextjsVersionSpec, nextjsMajor, nextjsMinor } = repository.frameworks;
  if (!nextjsVersionSpec || nextjsMajor !== 13 || nextjsMinor === undefined || nextjsMinor >= 3) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: "package.json", line: 1, column: 1 },
      message: `The repository is on Next.js ${nextjsVersionSpec}, below the 13.3 build-performance milestone.`,
      why: milestoneWhy(nextjsMinor),
      suggestion: `If a major-version upgrade is not feasible yet, move Next.js from ${nextjsVersionSpec} to at least 13.3.x as the next 13.x CI performance target. Treat 13.4.x separately when App Router stability is the reason to upgrade.`,
      measurementHint:
        "Compare `next build` wall-clock time, SSG/static export time, cache behavior, and bundle size before and after upgrading to Next.js 13.3.x.",
      aiHandoff: `Review the repository Next.js version. If compatibility allows, upgrade Next.js from ${nextjsVersionSpec} to at least 13.3.x as the next 13.x CI performance milestone, and consider 13.4.x separately only when App Router stability is relevant.`,
      score: nextjsMinor === 2 ? 50 : 48,
    }),
  ];
}
