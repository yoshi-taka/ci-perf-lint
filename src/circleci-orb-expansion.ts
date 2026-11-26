import type { AnalysisWarning } from "./types.ts";
import { isMap, isNode, isScalar, isSeq, YAMLMap, type Node } from "./yaml.ts";
import { parseCiYaml } from "./ci-yaml.ts";
import {
  parseCircleCiSteps,
  type CircleCiDocument,
  type CircleCiJob,
  type CircleCiStep,
} from "./circleci-workflow.ts";

const MAX_ORB_FETCH_BYTES = 5_000_000;
const MAX_ORB_DEPTH = 5;
const MAX_EXPANSION_DEPTH = 12;
const ORB_CACHE_LIMIT = 128;
const ORB_FETCH_TIMEOUT_MS = 8_000;
const ORB_API_BASE = "https://app.circleci.com/api/v2/orbs";
const SKIPPED_ORBS = new Set(["circleci/continuation", "circleci/path-filtering"]);

interface OrbFetchResult {
  source?: string;
  error?: string;
}

interface OrbDefinition {
  readonly fullName: string;
  readonly version: string;
  readonly commands: Map<string, YAMLMap<unknown, unknown>>;
  readonly jobs: Map<string, YAMLMap<unknown, unknown>>;
  readonly orbs: Map<string, OrbDefinition>;
}

interface OrbExpansionState {
  readonly warnings: AnalysisWarning[];
  readonly source: string;
  readonly definitions: Map<string, OrbDefinition | null>;
  readonly loading: Set<string>;
}

interface OrbScope {
  readonly orbs: Map<string, OrbDefinition>;
  readonly commands: Map<string, YAMLMap<unknown, unknown>>;
}

const orbSourceCache = new Map<string, Promise<OrbFetchResult>>();

function cacheOrbSource(key: string, load: Promise<OrbFetchResult>): Promise<OrbFetchResult> {
  orbSourceCache.set(key, load);
  if (orbSourceCache.size > ORB_CACHE_LIMIT) {
    const oldest = orbSourceCache.keys().next().value;
    if (oldest !== undefined) {
      orbSourceCache.delete(oldest);
    }
  }
  return load;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal:
      typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(ORB_FETCH_TIMEOUT_MS)
        : undefined,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function fetchOrbSource(
  namespace: string,
  name: string,
  version: string,
): Promise<OrbFetchResult> {
  const key = `${namespace}/${name}@${version}`;
  const cached = orbSourceCache.get(key);
  if (cached) {
    return cached;
  }
  const load = (async (): Promise<OrbFetchResult> => {
    try {
      const search = asRecord(
        await fetchJson(
          `${ORB_API_BASE}?ns=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`,
        ),
      );
      const items = Array.isArray(search?.items) ? search.items : [];
      const id = asRecord(items[0])?.id;
      if (typeof id !== "string") {
        return { error: "orb was not found in the public registry" };
      }
      const detail = asRecord(
        await fetchJson(
          `${ORB_API_BASE}/${encodeURIComponent(id)}?version=${encodeURIComponent(version)}`,
        ),
      );
      const published = asRecord(detail?.published);
      const source = published?.source;
      if (typeof source !== "string" || source.trim() === "") {
        return { error: "orb source was not published" };
      }
      if (source.length > MAX_ORB_FETCH_BYTES) {
        return { error: "orb source exceeds the size limit" };
      }
      return { source };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  })();
  return cacheOrbSource(key, load);
}

function scalarValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (isScalar(value) && typeof value.value === "string") {
    return value.value;
  }
  return undefined;
}

function nodeAt(map: YAMLMap<unknown, unknown>, key: string): Node | undefined {
  const value = map.get(key, true);
  return isNode(value) ? value : undefined;
}

function mapAt(map: YAMLMap<unknown, unknown>, key: string): YAMLMap<unknown, unknown> | undefined {
  const node = nodeAt(map, key);
  return node && isMap(node) ? node : undefined;
}

function mapEntries(
  map: YAMLMap<unknown, unknown> | undefined,
): [string, YAMLMap<unknown, unknown>][] {
  if (!map) {
    return [];
  }
  const entries: [string, YAMLMap<unknown, unknown>][] = [];
  for (const pair of map.items) {
    const key = scalarValue(pair.key);
    if (key !== undefined && isMap(pair.value)) {
      entries.push([key, pair.value]);
    }
  }
  return entries;
}

function mapDefinition(
  map: YAMLMap<unknown, unknown> | undefined,
): Map<string, YAMLMap<unknown, unknown>> {
  return new Map(mapEntries(map));
}

function parseOrbReference(value: string):
  | {
      namespace: string;
      name: string;
      version: string;
      fullName: string;
    }
  | undefined {
  if (/[$`<>{}\s]/.test(value)) {
    return undefined;
  }
  const at = value.lastIndexOf("@");
  if (at <= 0) {
    return undefined;
  }
  const pathPart = value.slice(0, at);
  const version = value.slice(at + 1);
  const slash = pathPart.indexOf("/");
  if (slash <= 0 || slash === pathPart.length - 1 || !version) {
    return undefined;
  }
  return {
    namespace: pathPart.slice(0, slash),
    name: pathPart.slice(slash + 1),
    version,
    fullName: pathPart,
  };
}

async function loadOrbDefinition(
  reference: string,
  depth: number,
  state: OrbExpansionState,
): Promise<OrbDefinition | undefined> {
  const parsed = parseOrbReference(reference);
  if (!parsed || SKIPPED_ORBS.has(parsed.fullName)) {
    return undefined;
  }
  const cacheKey = `${parsed.fullName}@${parsed.version}`;
  if (state.definitions.has(cacheKey)) {
    return state.definitions.get(cacheKey) ?? undefined;
  }
  if (depth > MAX_ORB_DEPTH || state.loading.has(cacheKey)) {
    return undefined;
  }
  state.loading.add(cacheKey);
  try {
    const fetched = await fetchOrbSource(parsed.namespace, parsed.name, parsed.version);
    if (!fetched.source) {
      state.definitions.set(cacheKey, null);
      state.warnings.push({
        kind: "scan-warning",
        source: state.source,
        message: `CircleCI orb ${cacheKey} could not be expanded: ${fetched.error ?? "unknown error"}. Its implementation remains opaque.`,
      });
      return undefined;
    }
    let root: YAMLMap<unknown, unknown> | undefined;
    try {
      const document = parseCiYaml(fetched.source, "circleci");
      if (document.errors.length === 0 && document.contents && isMap(document.contents)) {
        root = document.contents;
      }
    } catch {
      root = undefined;
    }
    if (!root) {
      state.definitions.set(cacheKey, null);
      state.warnings.push({
        kind: "scan-warning",
        source: state.source,
        message: `CircleCI orb ${cacheKey} source could not be parsed. Its implementation remains opaque.`,
      });
      return undefined;
    }

    const nested = new Map<string, OrbDefinition>();
    const orbsMap = mapAt(root, "orbs");
    const nestedReferences: [string, string][] = [];
    if (orbsMap) {
      for (const pair of orbsMap.items) {
        const alias = scalarValue(pair.key);
        const nestedReference = scalarValue(pair.value);
        if (alias !== undefined && nestedReference !== undefined) {
          nestedReferences.push([alias, nestedReference]);
        }
      }
    }
    await Promise.all(
      nestedReferences.map(async ([alias, nestedReference]) => {
        const definition = await loadOrbDefinition(nestedReference, depth + 1, state);
        if (definition) {
          nested.set(alias, definition);
        }
      }),
    );

    const definition: OrbDefinition = {
      fullName: parsed.fullName,
      version: parsed.version,
      commands: mapDefinition(mapAt(root, "commands")),
      jobs: mapDefinition(mapAt(root, "jobs")),
      orbs: nested,
    };
    state.definitions.set(cacheKey, definition);
    return definition;
  } finally {
    state.loading.delete(cacheKey);
  }
}

function aliasIsUsed(alias: string, source: string | undefined): boolean {
  if (source === undefined) {
    return true;
  }
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w-])${escaped}/`).test(source);
}

async function loadRootScope(
  document: CircleCiDocument,
  state: OrbExpansionState,
): Promise<OrbScope> {
  const root = document.root;
  const orbs = new Map<string, OrbDefinition>();
  if (root) {
    const orbsMap = mapAt(root, "orbs");
    if (orbsMap) {
      await Promise.all(
        orbsMap.items.map(async (pair) => {
          const alias = scalarValue(pair.key);
          const reference = scalarValue(pair.value);
          if (alias === undefined || reference === undefined) {
            return;
          }
          if (!aliasIsUsed(alias, document.source)) {
            return;
          }
          const definition = await loadOrbDefinition(reference, 0, state);
          if (definition) {
            orbs.set(alias, definition);
          }
        }),
      );
    }
  }
  return {
    orbs,
    commands: mapDefinition(root ? mapAt(root, "commands") : undefined),
  };
}

function cloneStepAt(step: CircleCiStep, invocationNode: Node | undefined): CircleCiStep {
  if (!invocationNode) {
    return { ...step, expandedFromOrb: true };
  }
  return {
    ...step,
    node: isMap(invocationNode) ? invocationNode : step.node,
    nameNode: invocationNode,
    commandNode: invocationNode,
    expandedFromOrb: true,
  };
}

function expandSteps(
  steps: CircleCiStep[],
  scope: OrbScope,
  depth: number,
  active: Set<string>,
  invocationNode?: Node,
): CircleCiStep[] {
  if (depth > MAX_EXPANSION_DEPTH) {
    return steps;
  }
  const expanded: CircleCiStep[] = [];
  for (const step of steps) {
    const node = invocationNode ?? step.node;
    if (step.type === "when" || step.type === "unless") {
      const args = isMap(step.node.items[0]?.value) ? step.node.items[0].value : undefined;
      const nestedSteps = args ? nodeAt(args, "steps") : undefined;
      if (nestedSteps && isSeq(nestedSteps)) {
        expanded.push(
          ...expandSteps(parseCircleCiSteps(nestedSteps), scope, depth + 1, active, node),
        );
        continue;
      }
      expanded.push(cloneStepAt(step, node));
      continue;
    }

    const slash = step.type.indexOf("/");
    if (slash > 0) {
      const alias = step.type.slice(0, slash);
      const commandName = step.type.slice(slash + 1);
      const orb = scope.orbs.get(alias);
      const command = orb?.commands.get(commandName);
      const key = `${orb?.fullName ?? alias}/${commandName}`;
      const commandSteps = command ? nodeAt(command, "steps") : undefined;
      if (orb && commandSteps && isSeq(commandSteps) && !active.has(key)) {
        active.add(key);
        const orbScope: OrbScope = { orbs: orb.orbs, commands: orb.commands };
        expanded.push(
          ...expandSteps(parseCircleCiSteps(commandSteps), orbScope, depth + 1, active, node),
        );
        active.delete(key);
        continue;
      }
    } else {
      const command = scope.commands.get(step.type);
      const commandSteps = command ? nodeAt(command, "steps") : undefined;
      if (commandSteps && isSeq(commandSteps) && !active.has(step.type)) {
        active.add(step.type);
        expanded.push(
          ...expandSteps(parseCircleCiSteps(commandSteps), scope, depth + 1, active, node),
        );
        active.delete(step.type);
        continue;
      }
    }

    if (step.type.includes("/")) {
      const unresolved = invocationNode ? cloneStepAt(step, invocationNode) : { ...step };
      unresolved.orbUnresolved = true;
      expanded.push(unresolved);
      continue;
    }
    expanded.push(invocationNode ? cloneStepAt(step, invocationNode) : step);
  }
  return expanded;
}

function parseDockerImages(node: Node | undefined): string[] | undefined {
  if (!node || !isSeq(node)) {
    return undefined;
  }
  const images: string[] = [];
  for (const item of node.items) {
    if (isMap(item)) {
      const image = scalarValue(item.get("image", true));
      if (image) {
        images.push(image);
      }
    } else {
      const image = scalarValue(item);
      if (image) {
        images.push(image);
      }
    }
  }
  return images.length > 0 ? images : undefined;
}

function emptyMap(): YAMLMap<unknown, unknown> {
  const map = new YAMLMap<unknown, unknown>();
  map.range = [0, 0, 0];
  return map;
}

function workflowOrbJobs(root: YAMLMap<unknown, unknown>, scope: OrbScope): CircleCiJob[] {
  const workflows = mapAt(root, "workflows");
  if (!workflows) {
    return [];
  }
  const jobs = new Map<string, CircleCiJob>();
  for (const [workflowName, workflow] of mapEntries(workflows)) {
    if (workflowName === "version") {
      continue;
    }
    const workflowJobs = nodeAt(workflow, "jobs");
    if (!workflowJobs || !isSeq(workflowJobs)) {
      continue;
    }
    for (const item of workflowJobs.items) {
      let jobName: string | undefined;
      let invocationNode: Node | undefined;
      if (isScalar(item)) {
        jobName = scalarValue(item);
        invocationNode = item;
      } else if (isMap(item)) {
        const pair = item.items[0];
        jobName = scalarValue(pair?.key);
        invocationNode = item;
      }
      if (!jobName || !invocationNode) {
        continue;
      }
      const slash = jobName.indexOf("/");
      if (slash <= 0) {
        continue;
      }
      const alias = jobName.slice(0, slash);
      const orbJobName = jobName.slice(slash + 1);
      const orb = scope.orbs.get(alias);
      const definition = orb?.jobs.get(orbJobName);
      if (!orb || !definition || jobs.has(jobName)) {
        continue;
      }
      const stepsNode = nodeAt(definition, "steps");
      if (!stepsNode || !isSeq(stepsNode)) {
        continue;
      }
      const node = isMap(invocationNode) ? invocationNode : emptyMap();
      const orbScope: OrbScope = { orbs: orb.orbs, commands: orb.commands };
      jobs.set(jobName, {
        node,
        name: jobName,
        dockerImages: parseDockerImages(nodeAt(definition, "docker")),
        steps: expandSteps(parseCircleCiSteps(stepsNode), orbScope, 0, new Set(), invocationNode),
        expandedFromOrb: true,
      });
    }
  }
  return [...jobs.values()];
}

export async function expandCircleCiOrbs(
  document: CircleCiDocument,
  warnings: AnalysisWarning[],
): Promise<CircleCiDocument> {
  if (!document.root) {
    return document;
  }
  const state: OrbExpansionState = {
    warnings,
    source: document.relativePath,
    definitions: new Map(),
    loading: new Set(),
  };
  const scope = await loadRootScope(document, state);
  if (scope.orbs.size === 0 && scope.commands.size === 0) {
    return document;
  }

  const jobs = document.jobs.map((job) => ({
    ...job,
    steps: expandSteps(job.steps, scope, 0, new Set()),
  }));
  const knownJobs = new Set(jobs.map((job) => job.name));
  for (const orbJob of workflowOrbJobs(document.root, scope)) {
    if (!knownJobs.has(orbJob.name)) {
      jobs.push(orbJob);
      knownJobs.add(orbJob.name);
    }
  }

  return { ...document, jobs };
}
