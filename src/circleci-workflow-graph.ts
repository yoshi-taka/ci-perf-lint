import type { Node } from "./yaml.ts";
import { isMap, isScalar, isSeq } from "./yaml.ts";
import type { CircleCiDocument } from "./circleci-workflow.ts";

export interface CircleCiFilterSet {
  only?: string[];
  ignore?: string[];
}

export interface CircleCiInvocationFilters {
  branches?: CircleCiFilterSet;
  tags?: CircleCiFilterSet;
}

export interface CircleCiWorkflowInvocation {
  workflowName: string;
  /** Referenced job definition name. */
  jobName: string;
  /** Display name from `name:`, otherwise the job name. */
  alias: string;
  requires: string[];
  filters: CircleCiInvocationFilters;
  matrix: boolean;
  /** Pre/post steps attached to this specific workflow invocation. */
  preSteps?: Node;
  postSteps?: Node;
  /** Orb job that replaces the local job body. */
  overrideWith?: string;
  /** Name of the job group this invocation was expanded from. */
  groupName?: string;
  /** CircleCI serial-group carried from the group invocation. */
  serialGroup?: string;
  parameters: ReadonlyMap<string, string>;
  /** Expression-based conditions cannot be decided statically. */
  uncertain: boolean;
  node: Node | undefined;
}

const RESERVED_KEYS = new Set(["job", "name", "requires", "filters", "matrix", "context", "type"]);

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (isScalar(value) && typeof value.value === "string") {
    return value.value;
  }
  return undefined;
}

function plainText(value: unknown): string | undefined {
  const text = scalarText(value);
  if (text !== undefined) {
    return text;
  }
  const json = (value as { toJSON?: () => unknown } | undefined)?.toJSON?.();
  if (typeof json === "string") {
    return json;
  }
  if (typeof json === "number" || typeof json === "boolean") {
    return String(json);
  }
  return undefined;
}

function textArray(value: unknown): string[] | undefined {
  const items = isSeq(value) ? value.items : Array.isArray(value) ? value : undefined;
  return items?.map(plainText).filter((item): item is string => item !== undefined);
}

function filterValues(value: unknown): string[] | undefined {
  const array = textArray(value);
  if (array) {
    return array;
  }
  const single = plainText(value);
  return single ? [single] : undefined;
}

function parseFilterSet(value: unknown): CircleCiFilterSet | undefined {
  const single = plainText(value);
  if (single && !isMap(value)) {
    return { only: [single] };
  }
  if (!isMap(value)) {
    return undefined;
  }
  const result: CircleCiFilterSet = {};
  for (const pair of value.items) {
    const key = scalarText(pair.key);
    const values = filterValues(pair.value);
    if (key === "only" && values) {
      result.only = values;
    } else if (key === "ignore" && values) {
      result.ignore = values;
    }
  }
  return result;
}

function parseFilters(value: unknown): CircleCiInvocationFilters {
  if (!isMap(value)) {
    return {};
  }
  const filters: CircleCiInvocationFilters = {};
  for (const pair of value.items) {
    const key = scalarText(pair.key);
    if (key === "branches") {
      filters.branches = parseFilterSet(pair.value);
    } else if (key === "tags") {
      filters.tags = parseFilterSet(pair.value);
    }
  }
  return filters;
}

function invocationFromConfig(
  workflowName: string,
  jobName: string,
  config: unknown,
  node: Node | undefined,
): CircleCiWorkflowInvocation | undefined {
  const mapConfig = isMap(config) ? config : undefined;
  const alias = plainText(mapConfig?.get("name", true)) ?? jobName;
  const requires = textArray(mapConfig?.get("requires", true)) ?? [];
  const parameters = new Map<string, string>();
  for (const pair of mapConfig?.items ?? []) {
    const key = scalarText(pair.key);
    if (!key || RESERVED_KEYS.has(key)) {
      continue;
    }
    const value = plainText(pair.value);
    if (value !== undefined) {
      parameters.set(key, value);
    }
  }
  return {
    workflowName,
    jobName,
    alias,
    requires,
    filters: parseFilters(mapConfig?.get("filters", true)),
    matrix: mapConfig?.get("matrix", true) !== undefined,
    preSteps: mapConfig ? (mapConfig.get("pre-steps", true) as Node | undefined) : undefined,
    postSteps: mapConfig ? (mapConfig.get("post-steps", true) as Node | undefined) : undefined,
    overrideWith: plainText(mapConfig?.get("override-with", true)),
    serialGroup: plainText(mapConfig?.get("serial-group", true)),
    parameters,
    uncertain: /pipeline\.git\.|==/.test(
      JSON.stringify((mapConfig as { toJSON?: () => unknown } | undefined)?.toJSON?.() ?? ""),
    ),
    node,
  };
}

function parseJobsNode(
  workflowName: string,
  jobsNode: Node | undefined,
): CircleCiWorkflowInvocation[] {
  const invocations: CircleCiWorkflowInvocation[] = [];
  if (!isSeq(jobsNode)) {
    return invocations;
  }
  for (const item of jobsNode.items) {
    const scalarJob = scalarText(item);
    if (scalarJob) {
      invocations.push({
        workflowName,
        jobName: scalarJob,
        alias: scalarJob,
        requires: [],
        filters: {},
        matrix: false,
        preSteps: undefined,
        postSteps: undefined,
        overrideWith: undefined,
        serialGroup: undefined,
        parameters: new Map(),
        uncertain: false,
        node: undefined,
      });
      continue;
    }
    if (!isMap(item)) {
      continue;
    }
    const explicitJob = plainText(item.get("job", true));
    if (explicitJob) {
      const invocation = invocationFromConfig(workflowName, explicitJob, item, item);
      if (invocation) {
        invocations.push(invocation);
      }
      continue;
    }
    for (const pair of item.items) {
      const jobName = scalarText(pair.key);
      if (!jobName || RESERVED_KEYS.has(jobName)) {
        continue;
      }
      const invocation = invocationFromConfig(workflowName, jobName, pair.value, item);
      if (invocation) {
        invocations.push(invocation);
      }
      break;
    }
  }
  return invocations;
}

/** Parse both `- job:` references and the standard `- <job-name>:` form. */
export function collectCircleCiWorkflowInvocations(
  doc: CircleCiDocument,
): CircleCiWorkflowInvocation[] {
  const workflows = doc.root?.get("workflows", true);
  if (!isMap(workflows)) {
    return [];
  }

  const groupDefinitions = new Map<string, Node>();
  const groupsNode = doc.root?.get("job-groups", true);
  if (isMap(groupsNode)) {
    for (const pair of groupsNode.items) {
      const groupName = scalarText(pair.key);
      if (!groupName || !isMap(pair.value)) {
        continue;
      }
      const jobsNode = pair.value.get("jobs", true);
      if (isSeq(jobsNode)) {
        groupDefinitions.set(groupName, jobsNode);
      }
    }
  }

  const parsed: CircleCiWorkflowInvocation[] = [];
  for (const workflowPair of workflows.items) {
    const workflowName = scalarText(workflowPair.key);
    if (!workflowName || !isMap(workflowPair.value)) {
      continue;
    }
    parsed.push(
      ...parseJobsNode(workflowName, workflowPair.value.get("jobs", true) as Node | undefined),
    );
  }
  return expandJobGroups(parsed, groupDefinitions);
}

function expandJobGroups(
  invocations: readonly CircleCiWorkflowInvocation[],
  groupDefinitions: ReadonlyMap<string, Node>,
): CircleCiWorkflowInvocation[] {
  const result: CircleCiWorkflowInvocation[] = [];
  const exitAliases = new Map<string, string[]>();

  for (const invocation of invocations) {
    if (!groupDefinitions.has(invocation.jobName)) {
      result.push(invocation);
      continue;
    }
    const inner = parseJobsNode(invocation.workflowName, groupDefinitions.get(invocation.jobName));
    const requiredInside = new Set(inner.flatMap((item) => item.requires));
    const prefix = (alias: string) => `${invocation.alias}/${alias}`;
    const expanded = inner.map((item) => ({
      ...item,
      alias: prefix(item.alias),
      requires: item.requires.map(prefix),
      filters: invocation.filters,
      serialGroup: invocation.serialGroup ?? item.serialGroup,
      groupName: invocation.jobName,
      preSteps: item.preSteps ?? invocation.preSteps,
      postSteps: item.postSteps ?? invocation.postSteps,
      node: item.node ?? invocation.node,
    }));
    const exitAliasesForGroup = expanded
      .filter((item) => !requiredInside.has(item.alias.replace(`${invocation.alias}/`, "")))
      .map((item) => item.alias);
    exitAliases.set(invocation.alias, exitAliasesForGroup);
    for (const item of expanded) {
      result.push({
        ...item,
        requires:
          item.requires.length === 0
            ? invocation.requires.flatMap(
                (requirement) => exitAliases.get(requirement) ?? [requirement],
              )
            : item.requires,
      });
    }
  }

  return result.map((invocation) => ({
    ...invocation,
    requires: invocation.requires.flatMap(
      (requirement) => exitAliases.get(requirement) ?? [requirement],
    ),
  }));
}

function isBranchRegex(value: string): boolean {
  return value.length > 1 && value.startsWith("/") && value.slice(1).includes("/");
}

function regexMatchesBranch(pattern: string, branch: string): boolean {
  const lastSlash = pattern.lastIndexOf("/");
  try {
    return new RegExp(pattern.slice(1, lastSlash)).test(branch);
  } catch {
    return false;
  }
}

function matchesPattern(pattern: string, value: string): boolean {
  return isBranchRegex(pattern) ? regexMatchesBranch(pattern, value) : pattern === value;
}

function setAllowsValue(set: CircleCiFilterSet, value: string): boolean {
  if (set.ignore?.some((pattern) => matchesPattern(pattern, value))) {
    return false;
  }
  const only = set.only ?? [];
  return only.length === 0 || only.some((pattern) => matchesPattern(pattern, value));
}

/** Representative branch/tag names shared with the formal model. */
const TRIGGER_CANDIDATES: string[] = [
  "main",
  "develop",
  "feature-1",
  "v1",
  "v1.0",
  "v11",
  "v2.0",
  "release-1",
];

function triggerOverlap(
  a: CircleCiFilterSet | undefined,
  b: CircleCiFilterSet | undefined,
  enabledByDefault: boolean,
): boolean {
  if (!enabledByDefault && (!a || !b)) {
    return false;
  }
  // Branch and tag triggers are independent: an all-branches ignore must not
  // stop the tag comparison.
  const left = a ?? {};
  const right = b ?? {};
  const candidates = [...TRIGGER_CANDIDATES];
  for (const set of [left, right]) {
    for (const pattern of set.only ?? []) {
      if (!isBranchRegex(pattern)) {
        candidates.push(pattern);
      }
    }
  }
  return candidates.some((value) => setAllowsValue(left, value) && setAllowsValue(right, value));
}

/** Missing filters mean all branches but no tags; disjoint `only` sets cannot co-run. */
export function circleCiInvocationsCanCoRun(
  a: CircleCiWorkflowInvocation,
  b: CircleCiWorkflowInvocation,
): boolean {
  return (
    triggerOverlap(a.filters.branches, b.filters.branches, true) ||
    triggerOverlap(a.filters.tags, b.filters.tags, false)
  );
}
