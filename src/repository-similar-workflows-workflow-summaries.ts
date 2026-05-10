import type { WorkflowDocument } from "./workflow.ts";
import { isHeavyWorkflow, workflowHasConcurrency } from "./rules/shared/workflow-jobs.ts";
import {
  workflowHasBranchPushTrigger,
  workflowHasNonCodeIgnore,
  workflowHasPullRequestTrigger,
  workflowHasScheduleTrigger,
  workflowHasTagOnlyPushTrigger,
  workflowHasTriggerPathFilter,
} from "./rules/shared/workflow-triggers.ts";
import { buildWorkflowFeatureSet } from "./rules/shared/workflow-features.ts";

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
