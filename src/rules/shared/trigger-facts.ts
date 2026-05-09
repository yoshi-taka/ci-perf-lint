import type { WorkflowDocument } from "../../workflow.ts";

export interface TriggerFacts {
  readonly events: ReadonlySet<string>;
  readonly hasPush: boolean;
  readonly hasPullRequest: boolean;
  readonly hasSchedule: boolean;
  readonly hasWorkflowDispatch: boolean;
  readonly hasRepositoryDispatch: boolean;
  readonly hasWorkflowCall: boolean;
  readonly hasWorkflowRun: boolean;
  readonly isManualOnly: boolean;
  readonly push: PushTriggerFacts;
  readonly pullRequest: PullRequestTriggerFacts;
  readonly hasTriggerPathFilter: boolean;
  readonly hasNonCodeIgnore: boolean;
  readonly scheduleCrons: readonly string[];
}

export interface PushTriggerFacts {
  readonly hasBranches: boolean;
  readonly hasBranchesIgnore: boolean;
  readonly hasTags: boolean;
  readonly hasTagsIgnore: boolean;
  readonly hasTagOnly: boolean;
  readonly hasBranchPush: boolean;
  readonly hasPaths: boolean;
  readonly hasPathsIgnore: boolean;
}

export interface PullRequestTriggerFacts {
  readonly hasBranches: boolean;
  readonly hasBranchesIgnore: boolean;
  readonly hasPaths: boolean;
  readonly hasPathsIgnore: boolean;
  readonly hasPathFilter: boolean;
  readonly hasNonCodeIgnore: boolean;
}

function getOnRecord(workflow: WorkflowDocument): Record<string, unknown> | undefined {
  const { on } = workflow;
  if (!on || typeof on !== "object" || Array.isArray(on)) {
    return undefined;
  }
  return on as Record<string, unknown>;
}

function hasArrayField(config: Record<string, unknown> | undefined, name: string): boolean {
  return Array.isArray(config?.[name]);
}

function getNonCodeIgnore(eventConfig: Record<string, unknown> | undefined): boolean {
  const ignores = eventConfig?.["paths-ignore"];
  if (!Array.isArray(ignores)) {
    return false;
  }
  return ignores.some(
    (entry) => typeof entry === "string" && /(docs|\.md$|\.mdx$|README|CHANGELOG)/i.test(entry),
  );
}

function getCrons(schedule: unknown): string[] {
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

const triggerFactsCache = new WeakMap<WorkflowDocument, TriggerFacts>();

export function getTriggerFacts(workflow: WorkflowDocument): TriggerFacts {
  const cached = triggerFactsCache.get(workflow);
  if (cached) {
    return cached;
  }

  const facts = computeTriggerFacts(workflow);
  triggerFactsCache.set(workflow, facts);
  return facts;
}

function computeTriggerFacts(workflow: WorkflowDocument): TriggerFacts {
  const onRecord = getOnRecord(workflow);
  const events = new Set<string>();

  if (onRecord) {
    for (const key of Object.keys(onRecord)) {
      events.add(key);
    }
  }

  const hasPush = events.has("push");
  const hasPullRequest = events.has("pull_request");
  const hasSchedule = events.has("schedule");
  const hasWorkflowDispatch = events.has("workflow_dispatch");
  const hasRepositoryDispatch = events.has("repository_dispatch");
  const hasWorkflowCall = events.has("workflow_call");
  const hasWorkflowRun = events.has("workflow_run");

  const allEvents = events.size;
  const isManualOnly =
    allEvents === 1 &&
    (hasWorkflowDispatch || hasRepositoryDispatch) &&
    !hasSchedule &&
    !hasPush &&
    !hasPullRequest &&
    !hasWorkflowCall &&
    !hasWorkflowRun;

  const pushConfig = onRecord?.push;
  const push =
    pushConfig && typeof pushConfig === "object" && !Array.isArray(pushConfig)
      ? (pushConfig as Record<string, unknown>)
      : undefined;

  const pushFacts: PushTriggerFacts = {
    hasBranches: hasArrayField(push, "branches"),
    hasBranchesIgnore: hasArrayField(push, "branches-ignore"),
    hasTags: hasArrayField(push, "tags"),
    hasTagsIgnore: hasArrayField(push, "tags-ignore"),
    hasTagOnly:
      (hasArrayField(push, "tags") || hasArrayField(push, "tags-ignore")) &&
      !hasArrayField(push, "branches") &&
      !hasArrayField(push, "branches-ignore"),
    hasBranchPush: hasArrayField(push, "branches") || hasArrayField(push, "branches-ignore"),
    hasPaths: hasArrayField(push, "paths"),
    hasPathsIgnore: hasArrayField(push, "paths-ignore"),
  };

  const prConfig = onRecord?.pull_request;
  const pr =
    prConfig && typeof prConfig === "object" && !Array.isArray(prConfig)
      ? (prConfig as Record<string, unknown>)
      : undefined;

  const prFacts: PullRequestTriggerFacts = {
    hasBranches: hasArrayField(pr, "branches"),
    hasBranchesIgnore: hasArrayField(pr, "branches-ignore"),
    hasPaths: hasArrayField(pr, "paths"),
    hasPathsIgnore: hasArrayField(pr, "paths-ignore"),
    hasPathFilter: hasArrayField(pr, "paths") || hasArrayField(pr, "paths-ignore"),
    hasNonCodeIgnore: getNonCodeIgnore(pr),
  };

  const scheduleCrons = hasSchedule ? getCrons(onRecord?.schedule) : [];

  const hasTriggerPathFilter = [push, pr].some((cfg) =>
    cfg ? hasArrayField(cfg, "paths") || hasArrayField(cfg, "paths-ignore") : false,
  );

  const pushNonCodeIgnore = getNonCodeIgnore(push);
  const hasNonCodeIgnore = pushNonCodeIgnore || prFacts.hasNonCodeIgnore;

  return {
    events,
    hasPush,
    hasPullRequest,
    hasSchedule,
    hasWorkflowDispatch,
    hasRepositoryDispatch,
    hasWorkflowCall,
    hasWorkflowRun,
    isManualOnly,
    push: pushFacts,
    pullRequest: prFacts,
    hasTriggerPathFilter,
    hasNonCodeIgnore,
    scheduleCrons,
  };
}
