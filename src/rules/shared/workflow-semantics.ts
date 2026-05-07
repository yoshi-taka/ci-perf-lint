import type { WorkflowDocument } from "../../workflow.ts";
import { getWorkflowAnalysis } from "./workflow-analysis.ts";
import {
  workflowHasManualOnlyTrigger,
  workflowHasScheduleTrigger,
  workflowHasPushTrigger,
  workflowHasPullRequestTrigger,
  workflowHasTagOnlyPushTrigger,
  workflowHasBranchPushTrigger,
  workflowHasTriggerPathFilter,
} from "./workflow-triggers.ts";
import { workflowHasConcurrency, isHeavyWorkflow } from "./workflows.ts";

export interface WorkflowSemantics {
  trigger: {
    hasPush: boolean;
    hasPullRequest: boolean;
    hasSchedule: boolean;
    hasManualOnly: boolean;
    hasTagOnlyPush: boolean;
    hasBranchPush: boolean;
    hasPathFilter: boolean;
  };
  jobCount: number;
  stepCount: number;
  hasConcurrency: boolean;
  isHeavy: boolean;
}

export function buildWorkflowSemantics(workflow: WorkflowDocument): WorkflowSemantics {
  getWorkflowAnalysis(workflow);

  let stepCount = 0;
  for (const job of workflow.jobs) {
    stepCount += job.steps.length;
  }

  return {
    trigger: {
      hasPush: workflowHasPushTrigger(workflow),
      hasPullRequest: workflowHasPullRequestTrigger(workflow),
      hasSchedule: workflowHasScheduleTrigger(workflow),
      hasManualOnly: workflowHasManualOnlyTrigger(workflow),
      hasTagOnlyPush: workflowHasTagOnlyPushTrigger(workflow),
      hasBranchPush: workflowHasBranchPushTrigger(workflow),
      hasPathFilter: workflowHasTriggerPathFilter(workflow),
    },
    jobCount: workflow.jobs.length,
    stepCount,
    hasConcurrency: workflowHasConcurrency(workflow),
    isHeavy: isHeavyWorkflow(workflow),
  };
}
