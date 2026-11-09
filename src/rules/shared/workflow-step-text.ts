import type { WorkflowStep } from "../../workflow.ts";
import { getStepFacts } from "./step-facts.ts";

export function getLoweredWorkflowStepText(step: WorkflowStep): string {
  return getStepFacts(step).loweredStepText;
}
