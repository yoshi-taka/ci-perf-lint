import type { WorkflowDocument, WorkflowJob } from "./workflow.ts";
import { type DependencyFamily, detectInstallCommand } from "./rules/shared/tools.ts";
import {
  manualCacheStepMatchesDependencyFamily,
  setupActionHasBuiltInCacheForFamily,
} from "./rules/shared/workflow-caches.ts";
import {
  hasDirectHeavySignals,
  hasHistoryDependentCommand,
  isHeavyJob,
  jobHasMatrix,
  jobHasTimeout,
  jobIsStaticallyDisabled,
  hasOpaqueRepoScriptExecution,
  workflowLooksAgenticLike,
  workflowLooksReleaseLike,
} from "./rules/shared/workflow-jobs.ts";
import { getSetupActionKind } from "./rules/shared/workflow-setup-actions.ts";
import { getCheckoutStep } from "./rules/shared/workflow-analysis.ts";
import { jobMayMutateRepository } from "./rules/shared/workflow-mutation.ts";
import { buildJobFeatureSet } from "./rules/shared/workflow-features.ts";

export interface JobSummary {
  workflow: WorkflowDocument;
  job: WorkflowJob;
  features: Set<string>;
  featureMask: bigint;
  featureCount: number;
  isTimeoutCandidate: boolean;
  hasTimeout: boolean;
  isCacheCandidate: boolean;
  hasDependencyCache: boolean;
  isDeepCheckoutCandidate: boolean;
  usesDeepCheckout: boolean;
}

function jobUsesNxSetShas(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const uses = step.uses?.toLowerCase() ?? "";
    return uses.startsWith("nrwl/nx-set-shas@");
  });
}

export function collectJobSummaries(workflows: WorkflowDocument[]): JobSummary[] {
  const summaries: JobSummary[] = [];

  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      const installFamilies = new Set<DependencyFamily>();

      for (const step of job.steps) {
        const family = detectInstallCommand(step);
        if (family) {
          installFamilies.add(family as DependencyFamily);
        }
      }
      const hasDependencyCache = [...installFamilies].some((family) =>
        job.steps.some((step) => {
          const action = getSetupActionKind(step);
          return (
            (action !== undefined && setupActionHasBuiltInCacheForFamily(step, family)) ||
            manualCacheStepMatchesDependencyFamily(step, family)
          );
        }),
      );
      const checkoutStep = getCheckoutStep(job);
      const usesDeepCheckout =
        checkoutStep !== undefined &&
        (checkoutStep.with?.["fetch-depth"] === 0 || checkoutStep.with?.["fetch-depth"] === "0") &&
        checkoutStep.with["fetch-tags"] !== true &&
        checkoutStep.with["fetch-tags"] !== "true";

      summaries.push({
        workflow,
        job,
        features: buildJobFeatureSet(workflow, job),
        featureMask: 0n,
        featureCount: 0,
        isTimeoutCandidate:
          !job.usesReusableWorkflow &&
          !jobIsStaticallyDisabled(job) &&
          !jobHasMatrix(job) &&
          ((isHeavyJob(job) && hasDirectHeavySignals(job)) ||
            workflowLooksAgenticLike(workflow, job)),
        hasTimeout: jobHasTimeout(job),
        isCacheCandidate: installFamilies.size > 0,
        hasDependencyCache,
        isDeepCheckoutCandidate:
          checkoutStep !== undefined &&
          (!hasHistoryDependentCommand(job) || jobUsesNxSetShas(job)) &&
          !hasOpaqueRepoScriptExecution(job) &&
          !jobMayMutateRepository(workflow, job) &&
          !workflowLooksReleaseLike(workflow, job),
        usesDeepCheckout,
      });
    }
  }

  return summaries;
}
