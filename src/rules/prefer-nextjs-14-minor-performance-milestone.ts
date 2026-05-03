import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

// Source:
// - https://nextjs.org/blog/next-14-2
const meta = {
  id: "prefer-nextjs-14-minor-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-nextjs-14-minor-performance-milestone.md",
} satisfies RuleMeta;

function stepText(step: WorkflowStep): string {
  return `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""}`;
}

function jobRunsNextBuild(job: WorkflowJob): boolean {
  return job.steps.some((step) => /\bnext\s+build\b/i.test(stepText(step)));
}

export const preferNextjs14MinorPerformanceMilestoneRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { nextjsVersionSpec, nextjsMajor, nextjsMinor } = context.repository.frameworks;
    if (!nextjsVersionSpec || nextjsMajor !== 14 || nextjsMinor === undefined || nextjsMinor >= 2) {
      return [];
    }

    return workflow.jobs
      .filter((job) => jobRunsNextBuild(job))
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs Next.js builds while the repository is on Next.js ${nextjsVersionSpec}, below the 14.2 build-performance milestone.`,
          why: "Next.js 14.2 is the main 14.x CI/build milestone: it explicitly targets lower build memory usage, CSS optimizations, and production and caching improvements. Those map directly to common CI pain points such as memory-heavy builds and slow CSS processing.",
          suggestion: `If a major-version upgrade is not feasible yet, move Next.js from ${nextjsVersionSpec} to at least 14.2.x as the highest-value 14.x CI build target.`,
          measurementHint:
            "Compare `next build` wall-clock time, peak memory usage, CSS processing time, and production cache behavior before and after upgrading to Next.js 14.2.x.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and the repository Next.js version. If compatibility allows, upgrade Next.js from ${nextjsVersionSpec} to at least 14.2.x, then compare build time, peak memory, CSS processing, and cache behavior.`,
          score: 54,
        }),
      );
  },
};
