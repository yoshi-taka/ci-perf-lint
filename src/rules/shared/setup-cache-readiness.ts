import path from "node:path";
import { getNode, type WorkflowJob, type WorkflowStep } from "../../workflow.ts";
import { getSetupActionKind } from "./workflow-setup-actions.ts";

function unconditional(step: WorkflowStep): boolean {
  const value = getNode(step.node, "if")?.toJSON();
  if (value === undefined || value === true) {
    return true;
  }
  return (
    typeof value === "string" &&
    ["true", "success()"].includes(
      value
        .trim()
        .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
        .trim(),
    )
  );
}

function literalPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || /[$`\\!\r\n]/.test(value)) {
    return undefined;
  }
  const trimmed = value.trim();
  if (
    path.posix.isAbsolute(trimmed) ||
    /^(?:~|[a-z]:)/i.test(trimmed) ||
    trimmed.split("/").includes("..")
  ) {
    return undefined;
  }
  return trimmed.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "") || ".";
}

function goCacheEnabled(step: WorkflowStep): boolean {
  const major = /^actions\/setup-go@v(\d+)(?:[.\s]|$)/i.exec(step.uses ?? "")?.[1];
  if (major !== undefined && Number(major) < 3) {
    return false;
  }
  const cache = step.with?.cache;
  if (cache !== undefined) {
    return cache === true || cache === "true";
  }
  // v3 caching was opt-in; v4+ enables it by default. Unknown refs abstain.
  return major !== undefined && Number(major) >= 4;
}

function dependencyPaths(step: WorkflowStep): string[] | undefined {
  if (getSetupActionKind(step) === "ruby") {
    const directory = literalPath(step.with?.["working-directory"] ?? ".");
    return directory === undefined ? undefined : [directory];
  }
  const explicit = step.with?.["cache-dependency-path"];
  if (explicit !== undefined) {
    if (typeof explicit !== "string") {
      return undefined;
    }
    const paths = explicit.trim().split(/\r?\n/).map(literalPath);
    return paths.every((entry): entry is string => entry !== undefined) ? paths : undefined;
  }
  // Require a workspace-root checkout for default dependency discovery.
  // This deliberately abstains on recursive discovery in nested checkouts.
  return ["."];
}

function checkoutDirectory(step: WorkflowStep): string | undefined {
  if (!/^actions\/checkout@/i.test(step.uses ?? "") || !unconditional(step)) {
    return undefined;
  }
  // Sparse trees may omit the dependency file even when their path matches.
  if (step.with?.["sparse-checkout"] !== undefined) {
    return undefined;
  }
  const continueOnError = getNode(step.node, "continue-on-error")?.toJSON();
  if (continueOnError !== undefined && continueOnError !== false && continueOnError !== "false") {
    return undefined;
  }
  const directory = literalPath(step.with?.path ?? ".");
  return directory !== undefined && !/[*?[\]{}]/.test(directory) ? directory : undefined;
}

/** YAML prerequisites only: not proof of a dependency file, cache hit or successful restore. */
export function setupCacheHasCheckoutInputs(job: WorkflowJob, setupIndex: number): boolean {
  const setup = job.steps[setupIndex]!;
  if (!unconditional(setup)) {
    return false;
  }
  if (getSetupActionKind(setup) === "go" && !goCacheEnabled(setup)) {
    return false;
  }
  const paths = dependencyPaths(setup);
  if (!paths) {
    return false;
  }
  let checkout: string | undefined;
  for (const step of job.steps.slice(0, setupIndex)) {
    if (/^actions\/checkout@/i.test(step.uses ?? "")) {
      // Multiple checkout trees and conditional overwrites are not modeled.
      if (checkout !== undefined) {
        return false;
      }
      checkout = checkoutDirectory(step);
      if (checkout === undefined) {
        return false;
      }
    } else if (
      checkout !== undefined &&
      (step.run !== undefined ||
        (!getSetupActionKind(step) &&
          !/^actions\/cache(?:\/(?:restore|save))?@/i.test(step.uses ?? "")))
    ) {
      // Arbitrary preparation can delete/move dependency files or alter PATH/env.
      return false;
    }
  }
  return (
    checkout !== undefined &&
    paths.every(
      (entry) => checkout === "." || entry === checkout || entry.startsWith(`${checkout}/`),
    )
  );
}

export function manualCacheCanOverlap(
  job: WorkflowJob,
  setupIndex: number,
  manualIndex: number,
): boolean {
  if (!unconditional(job.steps[manualIndex]!)) {
    return false;
  }
  const start = Math.min(setupIndex, manualIndex);
  const end = Math.max(setupIndex, manualIndex);
  // A later checkout can change the dependency tree used by the manual key.
  return !job.steps
    .slice(start + 1, end)
    .some((step) => /^actions\/checkout@/i.test(step.uses ?? ""));
}
