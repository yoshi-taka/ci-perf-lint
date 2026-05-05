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
  jobRunsOnHostedMacos,
  jobRunsOnHostedUbuntu,
  jobRunsOnHostedWindows,
  jobUsesContainer,
  hasOpaqueRepoScriptExecution,
  workflowLooksAgenticLike,
  workflowLooksReleaseLike,
} from "./rules/shared/workflow-jobs.ts";
import { getSetupActionKind } from "./rules/shared/workflow-setup-actions.ts";
import { getCheckoutStep, getJobAnalysis } from "./rules/shared/workflow-analysis.ts";
import { jobMayMutateRepository } from "./rules/shared/workflow-mutation.ts";
import {
  workflowHasBranchPushTrigger,
  workflowHasPullRequestTrigger,
  workflowHasPushTrigger,
  workflowHasScheduleTrigger,
  workflowHasTriggerPathFilter,
} from "./rules/shared/workflow-triggers.ts";

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

function buildJobFeatureSet(workflow: WorkflowDocument, job: WorkflowJob): Set<string> {
  const features = new Set<string>();
  const loweredBlob = getJobAnalysis(job).loweredStepTextBlob;
  const jobText = `${job.id.toLowerCase()} ${loweredBlob}`;

  if (workflowHasPullRequestTrigger(workflow)) {
    features.add("trigger:pull_request");
  }
  if (workflowHasPushTrigger(workflow)) {
    features.add("trigger:push");
  }
  if (workflowHasScheduleTrigger(workflow)) {
    features.add("trigger:schedule");
  }
  if (workflowHasBranchPushTrigger(workflow)) {
    features.add("push:branch");
  }
  if (workflowHasTriggerPathFilter(workflow)) {
    features.add("filter:path");
  }
  if (workflowLooksAgenticLike(workflow, job)) {
    features.add("shape:agentic");
  }
  if (workflowLooksReleaseLike(workflow, job)) {
    features.add("shape:release");
  }
  if (isHeavyJob(job)) {
    features.add("shape:heavy");
  }
  if (jobHasMatrix(job)) {
    features.add("job:matrix");
  }
  if (jobUsesContainer(job)) {
    features.add("job:container");
  }
  if (jobRunsOnHostedUbuntu(job)) {
    features.add("runner:ubuntu");
  }
  if (jobRunsOnHostedWindows(job)) {
    features.add("runner:windows");
  }
  if (jobRunsOnHostedMacos(job)) {
    features.add("runner:macos");
  }
  if (/actions\/setup-node@|\bnpm\b|\bpnpm\b|\byarn\b|\bbun\b/.test(jobText)) {
    features.add("runtime:node");
  }
  if (/actions\/setup-python@|\bpip\b|\bpytest\b|\bruff\b|\buv\b/.test(jobText)) {
    features.add("runtime:python");
  }
  if (/actions\/setup-java@|\bgradle\b|\bmaven\b/.test(jobText)) {
    features.add("runtime:java");
  }
  if (/\bcargo\b|\brustup\b|\bnextest\b/.test(jobText)) {
    features.add("runtime:rust");
  }
  if (/docker\/build-push-action@|\bdocker\s+(?:build|buildx|compose)\b/.test(jobText)) {
    features.add("tool:docker");
  }
  if (/\b(?:lint|eslint|oxlint|ruff check)\b/.test(jobText)) {
    features.add("kind:lint");
  }
  if (/\b(?:test|jest|vitest|pytest|nextest)\b/.test(jobText)) {
    features.add("kind:test");
  }
  if (/\b(?:build|compile|bundle|pack)\b/.test(jobText)) {
    features.add("kind:build");
  }
  if (/\b(?:release|publish|deploy|upload)\b/.test(jobText)) {
    features.add("kind:release");
  }

  return features;
}

export function collectJobSummaries(workflows: WorkflowDocument[]): JobSummary[] {
  return workflows.flatMap((workflow) =>
    workflow.jobs.map((job) => {
      const installFamilies = new Set<DependencyFamily>(
        job.steps
          .map((step) => detectInstallCommand(step))
          .filter((family): family is DependencyFamily => family !== undefined),
      );
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

      return {
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
      };
    }),
  );
}
