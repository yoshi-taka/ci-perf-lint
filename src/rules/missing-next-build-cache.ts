import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowHasCachePath } from "./shared/workflow-caches.ts";
import { getWorkflowStepText } from "./shared/workflow-step-text.ts";

const meta = {
  id: "missing-next-build-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-next-build-cache.md",
} satisfies RuleMeta;

function jobRunsNextBuild(job: WorkflowJob): boolean {
  return job.steps.some((step) => /\bnext\s+build\b/i.test(getWorkflowStepText(step)));
}

const nextCachePathRe = /\.next\/cache\b/i;

export const missingNextBuildCacheRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (
      !context.repository.frameworks.usesNextjs ||
      workflowHasCachePath(workflow, nextCachePathRe)
    ) {
      return [];
    }

    return workflow.jobs
      .filter((job) => jobRunsNextBuild(job))
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs Next.js builds without a visible .next/cache strategy.`,
          why: "Next.js build cache often saves more repeated work than package-manager dependency caches, but no visible cache path for `.next/cache` is configured here.",
          suggestion:
            "If this CI path rebuilds the same app repeatedly, add one cache strategy for `.next/cache` and keep it only if total build time improves.",
          measurementHint:
            "Compare cache restore time, `next build` wall-clock time, and cache save time before and after adding `.next/cache` persistence.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and test whether persisting .next/cache improves total CI time for repeated Next.js builds on this path.`,
          score: 53,
        }),
      );
  },
};
