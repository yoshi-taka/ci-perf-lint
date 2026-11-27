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
  parameters: ReadonlyMap<string, string>;
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
    parameters,
    node,
  };
}

/** Parse both `- job:` references and the standard `- <job-name>:` form. */
export function collectCircleCiWorkflowInvocations(
  doc: CircleCiDocument,
): CircleCiWorkflowInvocation[] {
  const workflows = doc.root?.get("workflows", true);
  if (!isMap(workflows)) {
    return [];
  }

  const invocations: CircleCiWorkflowInvocation[] = [];
  for (const workflowPair of workflows.items) {
    const workflowName = scalarText(workflowPair.key);
    if (!workflowName || !isMap(workflowPair.value)) {
      continue;
    }
    const jobsNode = workflowPair.value.get("jobs", true);
    if (!isSeq(jobsNode)) {
      continue;
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
          parameters: new Map(),
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

      // Standard CircleCI form: `- test-coverage-report:` with nested options.
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
  }
  return invocations;
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

function onlySetsOverlap(
  a: CircleCiFilterSet | undefined,
  b: CircleCiFilterSet | undefined,
): boolean {
  if (!a?.only || !b?.only) {
    return true;
  }
  for (const left of a.only) {
    for (const right of b.only) {
      if (left === right) {
        return true;
      }
      if (isBranchRegex(left) && !isBranchRegex(right) && regexMatchesBranch(left, right)) {
        return true;
      }
      if (isBranchRegex(right) && !isBranchRegex(left) && regexMatchesBranch(right, left)) {
        return true;
      }
      // Two regexes cannot be decided statically; stay conservative.
      if (isBranchRegex(left) && isBranchRegex(right)) {
        return true;
      }
    }
  }
  return false;
}

/** Missing filters mean all branches/tags; disjoint explicit `only` sets cannot co-run. */
export function circleCiInvocationsCanCoRun(
  a: CircleCiWorkflowInvocation,
  b: CircleCiWorkflowInvocation,
): boolean {
  return (
    onlySetsOverlap(a.filters.branches, b.filters.branches) &&
    onlySetsOverlap(a.filters.tags, b.filters.tags)
  );
}
