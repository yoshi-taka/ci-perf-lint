import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

function stepText(step: WorkflowStep): string {
  return `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""}`;
}

function jobRunsNextBuild(job: WorkflowJob): boolean {
  return job.steps.some((step) => /\bnext\s+build\b/i.test(stepText(step)));
}

interface NextjsMilestoneConfig {
  id: string;
  docsPath: string;
  major: number;
  targetMinor: number;
  why: string | ((minor: number) => string);
  message: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: string;
  score: number | ((minor: number) => number);
}

function createNextjsMilestoneRule(config: NextjsMilestoneConfig) {
  const meta = {
    id: config.id,
    severity: "warning",
    confidence: "medium",
    docsPath: config.docsPath,
  } satisfies RuleMeta;

  return {
    meta,
    check(workflow: WorkflowDocument, context: RuleContext) {
      const { nextjsVersionSpec, nextjsMajor, nextjsMinor } = context.repository.frameworks;
      if (
        !nextjsVersionSpec ||
        nextjsMajor !== config.major ||
        nextjsMinor === undefined ||
        nextjsMinor >= config.targetMinor
      ) {
        return [];
      }

      return workflow.jobs
        .filter((job) => jobRunsNextBuild(job))
        .map((job) =>
          buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
            message: `Job "${job.id}" runs Next.js builds while the repository is on Next.js ${nextjsVersionSpec}, below the ${config.major}.${config.targetMinor} build-performance milestone.`,
            why: typeof config.why === "function" ? config.why(nextjsMinor) : config.why,
            suggestion: `If a major-version upgrade is not feasible yet, move Next.js from ${nextjsVersionSpec} to at least ${config.major}.${config.targetMinor}.x as the next ${config.major}.x CI performance target.`,
            measurementHint: config.measurementHint,
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and the repository Next.js version. If compatibility allows, upgrade Next.js from ${nextjsVersionSpec} to at least ${config.major}.${config.targetMinor}.x.`,
            score: typeof config.score === "function" ? config.score(nextjsMinor) : config.score,
          }),
        );
    },
  };
}

const configs: NextjsMilestoneConfig[] = [
  {
    id: "prefer-nextjs-12-minor-performance-milestone",
    docsPath: "docs/rules/prefer-nextjs-12-minor-performance-milestone.md",
    major: 12,
    targetMinor: 3,
    message: "",
    suggestion: "",
    measurementHint:
      "Compare `next build` wall-clock time, minification time, generated JavaScript size, and image-related build warnings before and after upgrading to Next.js 12.3.x.",
    aiHandoff: "",
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
    message: "",
    suggestion: "",
    measurementHint:
      "Compare `next build` wall-clock time, SSG/static export time, cache behavior, and bundle size before and after upgrading to Next.js 13.3.x.",
    aiHandoff: "",
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
    message: "",
    suggestion: "",
    measurementHint:
      "Compare `next build` wall-clock time, peak memory usage, CSS processing time, and production cache behavior before and after upgrading to Next.js 14.2.x.",
    aiHandoff: "",
    score: 54,
    why: "Next.js 14.2 is the main 14.x CI/build milestone: it explicitly targets lower build memory usage, CSS optimizations, and production and caching improvements. Those map directly to common CI pain points such as memory-heavy builds and slow CSS processing.",
  },
];

export const preferNextjs12MinorPerformanceMilestoneRule = createNextjsMilestoneRule(configs[0]!);
export const preferNextjs13MinorPerformanceMilestoneRule = createNextjsMilestoneRule(configs[1]!);
export const preferNextjs14MinorPerformanceMilestoneRule = createNextjsMilestoneRule(configs[2]!);
