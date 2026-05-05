import type { WorkflowDocument } from "./workflow.ts";
import { getWorkflowAnalysis } from "./rules/shared/workflow-analysis.ts";
import {
  isHeavyWorkflow,
  isHeavyJob,
  jobHasMatrix,
  jobRunsOnHostedMacos,
  jobRunsOnHostedUbuntu,
  jobRunsOnHostedWindows,
  jobUsesContainer,
  workflowHasConcurrency,
  workflowLooksAgenticLike,
  workflowLooksReleaseLike,
} from "./rules/shared/workflow-jobs.ts";
import {
  workflowHasBranchPushTrigger,
  workflowHasNonCodeIgnore,
  workflowHasPullRequestTrigger,
  workflowHasPushTrigger,
  workflowHasScheduleTrigger,
  workflowHasTagOnlyPushTrigger,
  workflowHasTriggerPathFilter,
} from "./rules/shared/workflow-triggers.ts";

interface WorkflowSummary {
  workflow: WorkflowDocument;
  features: Set<string>;
  featureMask: bigint;
  featureCount: number;
  eligibleForConcurrency: boolean;
  hasConcurrency: boolean;
  eligibleForPathsFilter: boolean;
  hasPathsFilter: boolean;
  eligibleForNonCodeIgnore: boolean;
  hasNonCodeIgnore: boolean;
}

function buildWorkflowFeatureSet(workflow: WorkflowDocument): Set<string> {
  const features = new Set<string>();
  const loweredBlob = getWorkflowAnalysis(workflow).loweredStepTextBlob;
  const jobIds = workflow.jobs.map((job) => job.id.toLowerCase()).join(" ");
  const workflowText = `${jobIds} ${loweredBlob}`;

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
  if (workflowHasTagOnlyPushTrigger(workflow)) {
    features.add("push:tag_only");
  }
  if (workflowHasTriggerPathFilter(workflow)) {
    features.add("filter:path");
  }
  if (workflow.jobs.some((job) => workflowLooksAgenticLike(workflow, job))) {
    features.add("shape:agentic");
  }
  if (workflow.jobs.some((job) => workflowLooksReleaseLike(workflow, job))) {
    features.add("shape:release");
  }
  if (workflow.jobs.some((job) => isHeavyJob(job))) {
    features.add("shape:heavy");
  }
  if (workflow.jobs.some((job) => jobHasMatrix(job))) {
    features.add("job:matrix");
  }
  if (workflow.jobs.some((job) => jobUsesContainer(job))) {
    features.add("job:container");
  }
  if (workflow.jobs.some((job) => jobRunsOnHostedUbuntu(job))) {
    features.add("runner:ubuntu");
  }
  if (workflow.jobs.some((job) => jobRunsOnHostedWindows(job))) {
    features.add("runner:windows");
  }
  if (workflow.jobs.some((job) => jobRunsOnHostedMacos(job))) {
    features.add("runner:macos");
  }
  if (/actions\/setup-node@|\bnpm\b|\bpnpm\b|\byarn\b|\bbun\b/.test(workflowText)) {
    features.add("runtime:node");
  }
  if (/actions\/setup-python@|\bpip\b|\bpytest\b|\bruff\b|\buv\b/.test(workflowText)) {
    features.add("runtime:python");
  }
  if (/actions\/setup-java@|\bgradle\b|\bmaven\b/.test(workflowText)) {
    features.add("runtime:java");
  }
  if (/\bcargo\b|\brustup\b|\bnextest\b/.test(workflowText)) {
    features.add("runtime:rust");
  }
  if (/docker\/build-push-action@|\bdocker\s+(?:build|buildx|compose)\b/.test(workflowText)) {
    features.add("tool:docker");
  }
  if (/\b(?:lint|eslint|oxlint|ruff check)\b/.test(workflowText)) {
    features.add("kind:lint");
  }
  if (/\b(?:test|jest|vitest|pytest|nextest)\b/.test(workflowText)) {
    features.add("kind:test");
  }
  if (/\b(?:build|compile|bundle|pack)\b/.test(workflowText)) {
    features.add("kind:build");
  }
  if (/\b(?:release|publish|deploy|upload)\b/.test(workflowText)) {
    features.add("kind:release");
  }

  return features;
}

function isConcurrencyEligible(workflow: WorkflowDocument): boolean {
  if (workflowHasScheduleTrigger(workflow)) {
    return false;
  }

  return isHeavyWorkflow(workflow);
}

export function collectWorkflowSummary(workflow: WorkflowDocument): WorkflowSummary {
  return {
    workflow,
    features: buildWorkflowFeatureSet(workflow),
    featureMask: 0n,
    featureCount: 0,
    eligibleForConcurrency: isConcurrencyEligible(workflow),
    hasConcurrency: workflowHasConcurrency(workflow),
    eligibleForPathsFilter:
      workflowHasPullRequestTrigger(workflow) ||
      workflowHasBranchPushTrigger(workflow) ||
      workflowHasTagOnlyPushTrigger(workflow),
    hasPathsFilter: workflowHasTriggerPathFilter(workflow),
    eligibleForNonCodeIgnore:
      workflowHasPullRequestTrigger(workflow) ||
      workflowHasBranchPushTrigger(workflow) ||
      workflowHasTagOnlyPushTrigger(workflow),
    hasNonCodeIgnore: workflowHasNonCodeIgnore(workflow),
  };
}
