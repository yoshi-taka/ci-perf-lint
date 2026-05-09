import type { WorkflowDocument } from "../../workflow.ts";
import { getTriggerFacts } from "./trigger-facts.ts";
import type { ActivationSurface } from "./trigger-facts.ts";

export interface TriggerSemantics {
  readonly activationSurface: ActivationSurface;
  readonly hasPush: boolean;
  readonly hasPullRequest: boolean;
  readonly hasSchedule: boolean;
  readonly isManualOnly: boolean;
  readonly hasTagOnlyPush: boolean;
  readonly hasBranchPush: boolean;
  readonly hasTriggerPathFilter: boolean;
  readonly hasNonCodeIgnore: boolean;
  readonly hasWorkflowDispatch: boolean;
  readonly hasWorkflowCall: boolean;
  readonly hasWorkflowRun: boolean;
  readonly scheduleCrons: readonly string[];
}

export function getTriggerSemantics(workflow: WorkflowDocument): TriggerSemantics {
  const tf = getTriggerFacts(workflow);
  return {
    activationSurface: tf.activationSurface,
    hasPush: tf.hasPush,
    hasPullRequest: tf.hasPullRequest,
    hasSchedule: tf.hasSchedule,
    isManualOnly: tf.isManualOnly,
    hasTagOnlyPush: tf.push.hasTagOnly,
    hasBranchPush: tf.push.hasBranchPush,
    hasTriggerPathFilter: tf.hasTriggerPathFilter,
    hasNonCodeIgnore: tf.hasNonCodeIgnore,
    hasWorkflowDispatch: tf.hasWorkflowDispatch,
    hasWorkflowCall: tf.hasWorkflowCall,
    hasWorkflowRun: tf.hasWorkflowRun,
    scheduleCrons: [...tf.scheduleCrons],
  };
}

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
