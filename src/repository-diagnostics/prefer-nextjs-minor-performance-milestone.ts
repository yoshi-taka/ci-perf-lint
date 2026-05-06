import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

interface NextjsMilestoneConfig {
  id: string;
  docsPath: string;
  major: number;
  targetMinor: number;
  why: string | ((minor: number) => string);
  suggestion: (versionSpec: string) => string;
  measurementHint: string;
  aiHandoff: (versionSpec: string) => string;
  score: number | ((minor: number) => number);
}

function createNextjsMilestoneCollector(config: NextjsMilestoneConfig) {
  const meta = {
    id: config.id,
    severity: "warning",
    confidence: "medium",
    docsPath: config.docsPath,
  } satisfies RuleMeta;

  return function collect(
    _repoRoot: string,
    repository: RepositorySignals,
    _warnings?: AnalysisWarning[],
  ): Diagnostic[] {
    const { nextjsVersionSpec, nextjsMajor, nextjsMinor } = repository.frameworks;
    if (
      !nextjsVersionSpec ||
      nextjsMajor !== config.major ||
      nextjsMinor === undefined ||
      nextjsMinor >= config.targetMinor
    ) {
      return [];
    }

    return [
      buildRepositoryDiagnostic(repository, meta, {
        location: { path: "package.json", line: 1, column: 1 },
        message: `The repository is on Next.js ${nextjsVersionSpec}, below the ${config.major}.${config.targetMinor} build-performance milestone.`,
        why: typeof config.why === "function" ? config.why(nextjsMinor) : config.why,
        suggestion: config.suggestion(nextjsVersionSpec),
        measurementHint: config.measurementHint,
        aiHandoff: config.aiHandoff(nextjsVersionSpec),
        score: typeof config.score === "function" ? config.score(nextjsMinor) : config.score,
      }),
    ];
  };
}

const configs = [
  {
    id: "prefer-nextjs-12-minor-performance-milestone",
    docsPath: "docs/rules/prefer-nextjs-12-minor-performance-milestone.md",
    major: 12,
    targetMinor: 3,
    measurementHint:
      "Compare `next build` wall-clock time, minification time, generated JavaScript size, and image-related build warnings before and after upgrading to Next.js 12.3.x.",
    suggestion: (ver: string) =>
      `If a major-version upgrade is not feasible yet, move Next.js from ${ver} to at least 12.3.x as the next low-risk 12.x CI performance target.`,
    aiHandoff: (ver: string) =>
      `Review the repository Next.js version. If compatibility allows, upgrade Next.js from ${ver} to at least 12.3.x before considering a later major-version migration.`,
    score: (minor: number) => (minor === 2 ? 51 : 49),
    why(currentMinor: number) {
      if (currentMinor <= 0) {
        return "Next.js 12.0 is below the 12.3 build-performance milestone. The 12.1 and 12.2 lines added more SWC compiler coverage, SWC minification work, on-demand ISR stabilization, and standalone output improvements, while 12.3 made SWC minification stable and continued image and compiler stabilization.";
      }
      if (currentMinor === 1) {
        return "Next.js 12.1 already has early SWC minification and compiler stabilization work, but it is still below the 12.2 and 12.3 CI-relevant milestones. Next.js 12.2 stabilized on-demand ISR and improved the compiler path, while 12.3 made SWC minification stable and continued image and compiler stabilization.";
      }
      return "Next.js 12.2 is close, but 12.3 is the stronger 12.x CI target because it makes SWC minification stable and includes additional image and compiler stabilization without requiring a major-version jump.";
    },
  },
  {
    id: "prefer-nextjs-13-minor-performance-milestone",
    docsPath: "docs/rules/prefer-nextjs-13-minor-performance-milestone.md",
    major: 13,
    targetMinor: 3,
    measurementHint:
      "Compare `next build` wall-clock time, SSG/static export time, cache behavior, and bundle size before and after upgrading to Next.js 13.3.x.",
    suggestion: (ver: string) =>
      `If a major-version upgrade is not feasible yet, move Next.js from ${ver} to at least 13.3.x as the next 13.x CI performance target. Treat 13.4.x separately when App Router stability is the reason to upgrade.`,
    aiHandoff: (ver: string) =>
      `Review the repository Next.js version. If compatibility allows, upgrade Next.js from ${ver} to at least 13.3.x as the next 13.x CI performance milestone, and consider 13.4.x separately only when App Router stability is relevant.`,
    score: (minor: number) => (minor === 2 ? 50 : 48),
    why(currentMinor: number) {
      if (currentMinor <= 0) {
        return "Next.js 13.0 is below the 13.3 build-performance milestone. The 13.1 line brought built-in module transpilation, SWC import-resolution, memory, HMR, and chunking improvements; 13.2 added the Next.js Cache beta and Rust MDX parser; and 13.3 added static export support for the App Router plus metadata and routing features that can matter for static-heavy builds.";
      }
      if (currentMinor === 1) {
        return "Next.js 13.1 has the first CI-relevant 13.x improvements, including built-in module transpilation and SWC import-resolution work, but it is still below the 13.2 and 13.3 build milestones. Next.js 13.2 added the Next.js Cache beta and Rust MDX parser, while 13.3 added App Router static export support and related routing and metadata features.";
      }
      return "Next.js 13.2 includes cache and Rust MDX work, but 13.3 is the stronger generic CI target for 13.x static-heavy repositories because it adds App Router static export support plus metadata and routing features. Next.js 13.4 is more of an App Router stability line than a generic build-performance target.";
    },
  },
  {
    id: "prefer-nextjs-14-minor-performance-milestone",
    docsPath: "docs/rules/prefer-nextjs-14-minor-performance-milestone.md",
    major: 14,
    targetMinor: 2,
    measurementHint:
      "Compare `next build` wall-clock time, peak memory usage, CSS processing time, and production cache behavior before and after upgrading to Next.js 14.2.x.",
    suggestion: (ver: string) =>
      `If a major-version upgrade is not feasible yet, move Next.js from ${ver} to at least 14.2.x as the highest-value 14.x CI build target.`,
    aiHandoff: (ver: string) =>
      `Review the repository Next.js version. If compatibility allows, upgrade Next.js from ${ver} to at least 14.2.x, then compare build time, peak memory, CSS processing, and cache behavior.`,
    score: 54,
    why: "Next.js 14.2 is the main 14.x CI/build milestone: it explicitly targets lower build memory usage, CSS optimizations, and production and caching improvements. Those map directly to common CI pain points such as memory-heavy builds and slow CSS processing.",
  },
];

export const collectPreferNextjs12MinorPerformanceMilestoneDiagnostics =
  createNextjsMilestoneCollector(configs[0]!);
export const collectPreferNextjs13MinorPerformanceMilestoneDiagnostics =
  createNextjsMilestoneCollector(configs[1]!);
export const collectPreferNextjs14MinorPerformanceMilestoneDiagnostics =
  createNextjsMilestoneCollector(configs[2]!);
