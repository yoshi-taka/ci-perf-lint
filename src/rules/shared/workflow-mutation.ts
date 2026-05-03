import type { WorkflowDocument, WorkflowJob } from "../../workflow.ts";

function getPermissionsRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function hasWriteLikePermission(permissions: Record<string, unknown> | undefined): boolean {
  if (!permissions) {
    return false;
  }

  return Object.values(permissions).some(
    (value) => typeof value === "string" && /(write|admin)/i.test(value),
  );
}

export function jobMayMutateRepository(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  const workflowPermissions = getPermissionsRecord(workflow.parsed?.permissions);
  const jobPermissions = getPermissionsRecord(job.raw.permissions);
  const hasMutationPermission =
    hasWriteLikePermission(jobPermissions) || hasWriteLikePermission(workflowPermissions);

  if (!hasMutationPermission) {
    return false;
  }

  return job.steps.some((step) => {
    const text = `${step.name ?? ""} ${step.uses ?? ""} ${step.run ?? ""}`.toLowerCase();
    return /(create pull request|create-pr|open pr|pull-request|comment|issue|label|vouch|release|publish|changeset|bump-version|version)/.test(
      text,
    );
  });
}
