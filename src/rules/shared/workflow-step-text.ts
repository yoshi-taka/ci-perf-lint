import type { WorkflowStep } from "../../workflow.ts";

const stepTextCache = new WeakMap<WorkflowStep, string>();
const loweredStepTextCache = new WeakMap<WorkflowStep, string>();

export function getWorkflowStepText(step: WorkflowStep): string {
  const cached = stepTextCache.get(step);
  if (cached !== undefined) {
    return cached;
  }

  const text = `${step.name ?? ""} ${step.uses ?? ""} ${step.run ?? ""}`;
  stepTextCache.set(step, text);
  return text;
}

export function getLoweredWorkflowStepText(step: WorkflowStep): string {
  const cached = loweredStepTextCache.get(step);
  if (cached !== undefined) {
    return cached;
  }

  const text = getWorkflowStepText(step).toLowerCase();
  loweredStepTextCache.set(step, text);
  return text;
}
