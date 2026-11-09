import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import { getMapValue, getScalarValue } from "../../workflow.ts";
import { isMap } from "../../yaml.ts";
import { getRunsOnSpec } from "./runs-on-facts.ts";

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

/** Only the default POSIX shell and explicit bash/sh are modeled by shell evidence. */
export function workflowHasUnmodeledShell(
  workflow: Pick<WorkflowDocument, "parsed"> | undefined,
  job: WorkflowJob,
  step: WorkflowStep,
): boolean {
  if (step.run === undefined) {
    return false;
  }
  const shellDefault = (raw: Record<string, unknown> | undefined): unknown => {
    const defaults = raw?.defaults as { run?: { shell?: unknown } } | undefined;
    return defaults?.run?.shell;
  };
  const shell =
    (isMap(step.node) ? getScalarValue(step.node, "shell") : undefined) ??
    shellDefault(job.raw) ??
    shellDefault(workflow?.parsed);
  return shell === undefined ? getRunsOnSpec(job).isWindows : shell !== "bash" && shell !== "sh";
}
