import type { WorkflowDocument, WorkflowJob } from "../../workflow.ts";
import { getJobFacts } from "./workflow-analysis.ts";
import {
  isHeavyJob,
  jobHasMatrix,
  jobRunsOnHostedMacos,
  jobRunsOnHostedUbuntu,
  jobRunsOnHostedWindows,
  jobUsesContainer,
  workflowLooksAgenticLike,
  workflowLooksReleaseLike,
} from "./workflow-jobs.ts";
import {
  workflowHasBranchPushTrigger,
  workflowHasPullRequestTrigger,
  workflowHasPushTrigger,
  workflowHasScheduleTrigger,
  workflowHasTagOnlyPushTrigger,
  workflowHasTriggerPathFilter,
} from "./workflow-triggers.ts";

export function buildJobFeatureSet(workflow: WorkflowDocument, job: WorkflowJob): Set<string> {
  const features = new Set<string>();
  const loweredBlob = getJobFacts(job).loweredStepTextBlob;
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

export function buildWorkflowFeatureSet(workflow: WorkflowDocument): Set<string> {
  const features = new Set<string>();

  for (const job of workflow.jobs) {
    const jobFeatures = buildJobFeatureSet(workflow, job);
    for (const f of jobFeatures) {
      features.add(f);
    }
  }

  if (workflowHasTagOnlyPushTrigger(workflow)) {
    features.add("push:tag_only");
  }

  return features;
}
