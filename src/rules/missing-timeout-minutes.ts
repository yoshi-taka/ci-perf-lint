import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import {
  hasDirectHeavySignals,
  isHeavyJob,
  jobIsStaticallyDisabled,
  jobHasMatrix,
  jobHasTimeout,
  workflowLooksAgenticLike,
  workflowLooksReleaseLike,
} from "./shared/workflow-jobs.ts";
import {
  workflowHasManualOnlyTrigger,
  workflowHasPullRequestTrigger,
  workflowHasPushTrigger,
} from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  withRepositoryTimeoutPrecedent,
  withSimilarWorkflowTimeoutConsensus,
} from "./shared/similar-workflow-consensus.ts";

const meta = {
  id: "missing-timeout-minutes",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-timeout-minutes.md",
} satisfies RuleMeta;

function stepLooksHeavy(step: WorkflowDocument["jobs"][number]["steps"][number]): boolean {
  const text = `${step.name ?? ""} ${step.uses ?? ""} ${step.run ?? ""}`.toLowerCase();
  return /(build|publish|release|deploy|upload|npm|pnpm|yarn|bun|cargo|gradle|maven|pytest|jest|vitest|tauri|electron)/.test(
    text,
  );
}

function jobHasHeavyStepTimeout(job: WorkflowDocument["jobs"][number]): boolean {
  return job.steps.some((step) => step.timeoutNode && stepLooksHeavy(step));
}

export const missingTimeoutMinutesRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    if (workflowHasManualOnlyTrigger(workflow)) {
      return [];
    }

    if (!workflowHasPullRequestTrigger(workflow) && !workflowHasPushTrigger(workflow)) {
      return [];
    }

    return workflow.jobs
      .filter(
        (job) =>
          !job.usesReusableWorkflow &&
          !jobIsStaticallyDisabled(job) &&
          !jobHasMatrix(job) &&
          ((isHeavyJob(job) && hasDirectHeavySignals(job)) ||
            workflowLooksAgenticLike(workflow, job)) &&
          !jobHasTimeout(job),
      )
      .map((job) =>
        withSimilarWorkflowTimeoutConsensus(
          withRepositoryTimeoutPrecedent(
            buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
              severity:
                (workflowLooksReleaseLike(workflow, job) ||
                  workflowLooksAgenticLike(workflow, job)) &&
                !jobHasHeavyStepTimeout(job)
                  ? "warning"
                  : undefined,
              message: `Job "${job.id}" does not define job-level timeout-minutes.`,
              why: jobHasHeavyStepTimeout(job)
                ? "This job already times out at least one heavy step, but without a job-level timeout the rest of the job still falls back to the platform default timeout."
                : workflowLooksAgenticLike(workflow, job)
                  ? "Without a job-level timeout, a hung agentic or AI-assisted job falls back to the platform default timeout and can keep consuming runner capacity for much longer than intended."
                  : workflowLooksReleaseLike(workflow, job)
                    ? "Without a job-level timeout, a hung release-like job falls back to the platform default timeout and can keep holding runner capacity and deployment-critical locks much longer than intended."
                    : "Without a job-level timeout, a hung or degraded job falls back to the platform default timeout and can keep consuming runner capacity much longer than intended.",
              suggestion:
                "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.",
              measurementHint:
                "Force or simulate a hung run and confirm the job is terminated at the configured timeout.",
              aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and add a sensible timeout-minutes value without breaking legitimate long-running work.`,
              score:
                (workflowLooksReleaseLike(workflow, job) ||
                  workflowLooksAgenticLike(workflow, job)) &&
                !jobHasHeavyStepTimeout(job)
                  ? 34
                  : 28,
            }),
            _context,
            workflow.relativePath,
            job.id,
          ),
          _context,
          workflow.relativePath,
          job.id,
          {
            scoreBonus: 6,
            why: "That makes this look less like a consciously unbounded job and more like one timeout policy gap in an otherwise consistent repository.",
            aiHandoff:
              "Use similar jobs in this repository as the starting point for the timeout value before tuning for this job's actual wall-clock behavior.",
          },
        ),
      );
  },
};
