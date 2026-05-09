import type { WorkflowStep } from "../../workflow.ts";
import { getStepFacts } from "./step-facts.ts";

export function getWorkflowStepText(step: WorkflowStep): string {
  return getStepFacts(step).stepText;
}

export function getLoweredWorkflowStepText(step: WorkflowStep): string {
  return getStepFacts(step).loweredStepText;
}
