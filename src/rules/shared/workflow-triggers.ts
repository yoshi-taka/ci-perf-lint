import type { WorkflowDocument } from "../../workflow.ts";
import { getTriggerFacts } from "./trigger-facts.ts";

export function workflowHasManualOnlyTrigger(workflow: WorkflowDocument): boolean {
  return getTriggerFacts(workflow).isManualOnly;
}

export function workflowHasScheduleTrigger(workflow: WorkflowDocument): boolean {
  return getTriggerFacts(workflow).hasSchedule;
}

export function getWorkflowScheduleCrons(workflow: WorkflowDocument): string[] {
  return [...getTriggerFacts(workflow).scheduleCrons];
}

export function workflowHasTriggerPathFilter(workflow: WorkflowDocument): boolean {
  return getTriggerFacts(workflow).hasTriggerPathFilter;
}

export function workflowHasPushTrigger(workflow: WorkflowDocument): boolean {
  return getTriggerFacts(workflow).hasPush;
}

export function workflowHasPullRequestTrigger(workflow: WorkflowDocument): boolean {
  return getTriggerFacts(workflow).hasPullRequest;
}

export function workflowHasTagOnlyPushTrigger(workflow: WorkflowDocument): boolean {
  return getTriggerFacts(workflow).push.hasTagOnly;
}

export function workflowHasBranchPushTrigger(workflow: WorkflowDocument): boolean {
  return getTriggerFacts(workflow).push.hasBranchPush;
}

export function workflowHasNonCodeIgnore(workflow: WorkflowDocument): boolean {
  return getTriggerFacts(workflow).hasNonCodeIgnore;
}
