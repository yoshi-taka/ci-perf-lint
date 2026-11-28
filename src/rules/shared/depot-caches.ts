import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";

/**
 * A cache disk mount is visible cache evidence only in Depot CI. The action does
 * nothing on standard GitHub-hosted runners, so the same YAML under
 * .github/workflows must not be treated as a dependency cache.
 */
function staticLiteral(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    !/[\r\n]/.test(value) &&
    !/[${}`]/.test(value)
  );
}

export function isDepotCacheMountStep(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
): boolean {
  if (!/(?:^|\/)\.depot\/workflows\//.test(workflow.relativePath)) {
    return false;
  }
  if (step.ifNode) {
    return false;
  }
  if (!/^depot\/cache-mount@(?:v1(?:\.\d+)*|[0-9a-f]{40})$/i.test(step.uses ?? "")) {
    return false;
  }
  const inputs = step.with;
  if (!inputs || !staticLiteral(inputs.name) || !staticLiteral(inputs.path)) {
    return false;
  }
  const index = job.steps.indexOf(step);
  // Callers require the mount to precede the matching install or task step.
  return index >= 0 && index < job.steps.length - 1;
}
