import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import { getMapValue } from "../../workflow.ts";

function defaultDirectory(raw: Record<string, unknown> | undefined): string | undefined {
  const defaults = raw?.defaults;
  if (!defaults || typeof defaults !== "object" || !("run" in defaults)) {
    return undefined;
  }
  const run = defaults.run;
  if (!run || typeof run !== "object" || !("working-directory" in run)) {
    return undefined;
  }
  return typeof run["working-directory"] === "string" ? run["working-directory"] : undefined;
}

export function workflowWorkingDirectory(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
): string {
  return (
    step.workingDirectory ?? defaultDirectory(job.raw) ?? defaultDirectory(workflow.parsed) ?? "."
  );
}

export function workflowStepEnv(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
): Record<string, unknown> {
  return {
    ...(workflow.root ? getMapValue(workflow.root, "env") : undefined),
    ...getMapValue(job.node, "env"),
    ...getMapValue(step.node, "env"),
  };
}
