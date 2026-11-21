import type { WorkflowDocument, WorkflowJob } from "../../workflow.ts";
import { shellNonDisplayInvocations } from "./shell-invocations.ts";
import { hasShellInputDocument } from "./command-patterns.ts";
import { workflowHasUnmodeledShell, workflowWorkingDirectory } from "./workflow-command-context.ts";

function literalDirectory(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || !/^[A-Za-z0-9_@./-]+$/.test(value)) {
    return undefined;
  }
  const parts = value.split("/").filter((part) => part && part !== ".");
  if (value.startsWith("/") || parts.includes("..")) {
    return undefined;
  }
  return parts.join("/") || ".";
}

function componentDirectory(directory: string): string | undefined {
  const parts = directory.split("/");
  // Keep all subdirectories of a conventional component in the same scope.
  if (["apps", "packages", "services", "crates"].includes(parts[0]!)) {
    // A scoped package is one level deeper: packages/@scope/name.
    const depth = parts[1]?.startsWith("@") ? 3 : 2;
    return parts.length >= depth ? parts.slice(0, depth).join("/") : undefined;
  }
  return parts[0] === "." ? undefined : parts[0];
}

/** A visible execution directory, not an independent dependency closure. */
export function jobComponentScope(
  workflow: WorkflowDocument,
  job: WorkflowJob,
): string | undefined {
  const checkouts = job.steps.filter((step) => /^actions\/checkout@/i.test(step.uses ?? ""));
  if (checkouts.length !== 1 || checkouts[0]!.with?.repository !== undefined) {
    return undefined;
  }
  const checkout = literalDirectory(checkouts[0]!.with?.path ?? ".");
  if (checkout === undefined) {
    return undefined;
  }
  let scope: string | undefined;
  for (const step of job.steps) {
    if (step.uses?.startsWith("./")) {
      // A local action can perform repository-wide work outside the run steps.
      return undefined;
    }
    if (step.run === undefined) {
      continue;
    }
    if (workflowHasUnmodeledShell(workflow, job, step) || hasShellInputDocument(step.run)) {
      return undefined;
    }
    const commands = shellNonDisplayInvocations(step.run);
    if (commands.length === 0) {
      continue;
    }
    if (
      /[$`]/.test(step.run) ||
      commands.some(
        ([tool, ...args]) =>
          ["cd", "pushd", "popd"].includes(tool ?? "") ||
          args.some(
            (arg) =>
              /^(?:--(?:prefix|cwd|directory|filter)(?:=|$)|-C$)/.test(arg) ||
              arg.split("/").includes(".."),
          ),
      )
    ) {
      return undefined;
    }
    const directory = literalDirectory(workflowWorkingDirectory(workflow, job, step));
    if (directory === undefined || (checkout !== "." && !directory.startsWith(`${checkout}/`))) {
      return undefined;
    }
    const relative = checkout === "." ? directory : directory.slice(checkout.length + 1);
    const component = componentDirectory(relative);
    if (!component || (scope !== undefined && scope !== component)) {
      // Root-wide work, or multiple components in one job, cannot be scoped safely.
      return undefined;
    }
    scope = component;
  }
  return scope;
}
