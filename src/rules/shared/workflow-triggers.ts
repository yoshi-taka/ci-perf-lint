import type { WorkflowDocument } from "../../workflow.ts";

function getOnRecord(workflow: WorkflowDocument): Record<string, unknown> | undefined {
  const { on } = workflow;
  if (!on || typeof on !== "object" || Array.isArray(on)) {
    return undefined;
  }

  return on as Record<string, unknown>;
}

function eventHasPathFilter(eventConfig: unknown): boolean {
  if (!eventConfig || Array.isArray(eventConfig) || typeof eventConfig === "string") {
    return false;
  }

  const record = eventConfig as Record<string, unknown>;
  return Array.isArray(record.paths) || Array.isArray(record["paths-ignore"]);
}

function getEventConfig(
  workflow: WorkflowDocument,
  eventName: "push" | "pull_request",
): Record<string, unknown> | undefined {
  const eventConfig = getOnRecord(workflow)?.[eventName];
  if (!eventConfig || typeof eventConfig !== "object" || Array.isArray(eventConfig)) {
    return undefined;
  }

  return eventConfig as Record<string, unknown>;
}

export function workflowHasManualOnlyTrigger(workflow: WorkflowDocument): boolean {
  const onRecord = getOnRecord(workflow);
  if (!onRecord) {
    return false;
  }

  return (
    Object.keys(onRecord).length === 1 &&
    (Object.hasOwn(onRecord, "workflow_dispatch") || Object.hasOwn(onRecord, "repository_dispatch"))
  );
}

export function workflowHasScheduleTrigger(workflow: WorkflowDocument): boolean {
  return Object.hasOwn(getOnRecord(workflow) ?? {}, "schedule");
}

export function getWorkflowScheduleCrons(workflow: WorkflowDocument): string[] {
  const schedule = getOnRecord(workflow)?.schedule;
  if (!Array.isArray(schedule)) {
    return [];
  }

  return schedule
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return undefined;
      }
      const cron = (entry as Record<string, unknown>).cron;
      return typeof cron === "string" && cron.trim().length > 0 ? cron.trim() : undefined;
    })
    .filter((value): value is string => Boolean(value));
}

export function workflowHasTriggerPathFilter(workflow: WorkflowDocument): boolean {
  const onRecord = getOnRecord(workflow);
  if (!onRecord) {
    return false;
  }

  return eventHasPathFilter(onRecord.push) || eventHasPathFilter(onRecord.pull_request);
}

export function workflowHasPushTrigger(workflow: WorkflowDocument): boolean {
  return Object.hasOwn(getOnRecord(workflow) ?? {}, "push");
}

export function workflowHasPullRequestTrigger(workflow: WorkflowDocument): boolean {
  return Object.hasOwn(getOnRecord(workflow) ?? {}, "pull_request");
}

export function workflowHasTagOnlyPushTrigger(workflow: WorkflowDocument): boolean {
  const pushConfig = getEventConfig(workflow, "push");
  if (!pushConfig) {
    return false;
  }

  const hasTags = Array.isArray(pushConfig.tags) || Array.isArray(pushConfig["tags-ignore"]);
  const hasBranches =
    Array.isArray(pushConfig.branches) || Array.isArray(pushConfig["branches-ignore"]);

  return hasTags && !hasBranches;
}

export function workflowHasBranchPushTrigger(workflow: WorkflowDocument): boolean {
  const pushConfig = getEventConfig(workflow, "push");
  if (!pushConfig) {
    return false;
  }

  const hasBranches =
    Array.isArray(pushConfig.branches) || Array.isArray(pushConfig["branches-ignore"]);

  return hasBranches;
}

export function workflowHasNonCodeIgnore(workflow: WorkflowDocument): boolean {
  const matchesIgnore = (eventConfig: unknown): boolean => {
    if (!eventConfig || typeof eventConfig !== "object" || Array.isArray(eventConfig)) {
      return false;
    }

    const ignores = (eventConfig as Record<string, unknown>)["paths-ignore"];
    if (!Array.isArray(ignores)) {
      return false;
    }

    return ignores.some(
      (entry) => typeof entry === "string" && /(docs|\.md$|\.mdx$|README|CHANGELOG)/i.test(entry),
    );
  };

  const onRecord = getOnRecord(workflow);
  if (!onRecord) {
    return false;
  }

  return matchesIgnore(onRecord.push) || matchesIgnore(onRecord.pull_request);
}
