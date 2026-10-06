import { isMap } from "yaml";
import {
  getMapValue,
  type WorkflowDocument,
  type WorkflowJob,
  type WorkflowStep,
} from "../../workflow.ts";

function envRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function effectiveStepEnvironment(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
): Record<string, unknown> {
  return {
    ...envRecord(workflow.parsed?.env),
    ...envRecord(job.raw.env),
    ...(isMap(step.node) ? getMapValue(step.node, "env") : {}),
  };
}
