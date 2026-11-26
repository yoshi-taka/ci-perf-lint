import { isMap, isNode, isScalar, isSeq, type Node, type YAMLMap } from "./yaml.ts";
import type { CircleCiDocument } from "./circleci-workflow.ts";

const SPECIAL_ORBS = new Set(["circleci/continuation", "circleci/path-filtering"]);

export interface CircleCiDockerEvidence {
  readonly reason: "setup_remote_docker" | "orb-dockerfile-parameter";
  readonly dockerfile?: string;
  readonly context?: string;
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

function nodeAt(map: YAMLMap<unknown, unknown> | undefined, key: string): Node | undefined {
  if (!map) {
    return undefined;
  }
  const value = map.get(key, true);
  return isNode(value) ? value : undefined;
}

function mapAt(map: YAMLMap<unknown, unknown> | undefined, key: string) {
  const value = nodeAt(map, key);
  return isMap(value) ? value : undefined;
}

function orbAliases(doc: CircleCiDocument): Set<string> {
  const aliases = new Set<string>();
  const orbs = mapAt(doc.root, "orbs");
  if (!orbs) {
    return aliases;
  }
  for (const pair of orbs.items) {
    const alias = scalarValue(pair.key);
    const reference = scalarValue(pair.value);
    if (!alias || !reference) {
      continue;
    }
    const at = reference.lastIndexOf("@");
    const fullName = at > 0 ? reference.slice(0, at) : reference;
    if (!SPECIAL_ORBS.has(fullName)) {
      aliases.add(alias);
    }
  }
  return aliases;
}

function workflowJobEntries(
  doc: CircleCiDocument,
): { alias: string; args?: YAMLMap<unknown, unknown> }[] {
  const entries: { alias: string; args?: YAMLMap<unknown, unknown> }[] = [];
  const workflows = mapAt(doc.root, "workflows");
  if (!workflows) {
    return entries;
  }
  for (const workflowPair of workflows.items) {
    if (workflowPair.key && scalarValue(workflowPair.key) === "version") {
      continue;
    }
    const jobs = nodeAt(workflowPair.value as YAMLMap<unknown, unknown> | undefined, "jobs");
    if (!jobs || !isSeq(jobs)) {
      continue;
    }
    for (const item of jobs.items) {
      if (isScalar(item)) {
        const name = scalarValue(item);
        const slash = name?.indexOf("/") ?? -1;
        if (name && slash > 0) {
          entries.push({ alias: name.slice(0, slash) });
        }
        continue;
      }
      if (!isMap(item)) {
        continue;
      }
      const pair = item.items[0];
      const name = scalarValue(pair?.key);
      const slash = name?.indexOf("/") ?? -1;
      if (!name || slash <= 0) {
        continue;
      }
      entries.push({
        alias: name.slice(0, slash),
        args: isMap(pair?.value) ? pair.value : undefined,
      });
    }
  }
  return entries;
}

function workflowJobArguments(
  doc: CircleCiDocument,
): Map<string, YAMLMap<unknown, unknown> | undefined> {
  const argumentsByJob = new Map<string, YAMLMap<unknown, unknown> | undefined>();
  const workflows = mapAt(doc.root, "workflows");
  if (!workflows) {
    return argumentsByJob;
  }
  for (const workflowPair of workflows.items) {
    if (workflowPair.key && scalarValue(workflowPair.key) === "version") {
      continue;
    }
    const jobs = nodeAt(workflowPair.value as YAMLMap<unknown, unknown> | undefined, "jobs");
    if (!jobs || !isSeq(jobs)) {
      continue;
    }
    for (const item of jobs.items) {
      if (isScalar(item)) {
        const name = scalarValue(item);
        if (name) {
          argumentsByJob.set(name, undefined);
        }
        continue;
      }
      if (!isMap(item)) {
        continue;
      }
      const pair = item.items[0];
      const name = scalarValue(pair?.key);
      if (name) {
        argumentsByJob.set(name, isMap(pair?.value) ? pair.value : undefined);
      }
    }
  }
  return argumentsByJob;
}

function stringValues(map: YAMLMap<unknown, unknown> | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  if (!map) {
    return values;
  }
  for (const pair of map.items) {
    const key = scalarValue(pair.key);
    const value = scalarValue(pair.value);
    if (key && value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}

function jobParameterDefaults(job: { node: YAMLMap<unknown, unknown> }): Record<string, string> {
  const parameters = mapAt(job.node, "parameters");
  const values: Record<string, string> = {};
  if (!parameters) {
    return values;
  }
  for (const pair of parameters.items) {
    const name = scalarValue(pair.key);
    const definition = isMap(pair.value) ? pair.value : undefined;
    const defaultValue = definition ? scalarValue(definition.get("default", true)) : undefined;
    if (name && defaultValue !== undefined) {
      values[name] = defaultValue;
    }
  }
  return values;
}

function resolveTemplate(value: string, parameters: Record<string, string>): string {
  return value.replace(
    /<<\s*parameters\.([A-Za-z0-9_-]+)\s*>>/g,
    (match, name: string) => parameters[name] ?? match,
  );
}

function evidenceFromArgs(
  args: YAMLMap<unknown, unknown> | undefined,
  parameters: Record<string, string> = {},
): CircleCiDockerEvidence | undefined {
  if (!args) {
    return undefined;
  }
  const rawDockerfile = scalarValue(args.get("dockerfile", true));
  if (!rawDockerfile) {
    return undefined;
  }
  const dockerfile = resolveTemplate(rawDockerfile, parameters);
  if (/<<\s*parameters\./.test(dockerfile)) {
    return undefined;
  }
  const rawContext =
    scalarValue(args.get("path", true)) ?? scalarValue(args.get("docker_context", true));
  const context = rawContext === undefined ? undefined : resolveTemplate(rawContext, parameters);
  return {
    reason: "orb-dockerfile-parameter",
    dockerfile,
    context: context && /<<\s*parameters\./.test(context) ? undefined : context,
  };
}

/** Docker evidence visible without fetching orb implementations. */
export function collectCircleCiDockerEvidence(doc: CircleCiDocument): CircleCiDockerEvidence[] {
  const evidence: CircleCiDockerEvidence[] = [];
  const seen = new Set<string>();
  const add = (entry: CircleCiDockerEvidence) => {
    const key = `${entry.reason}\0${entry.dockerfile ?? ""}\0${entry.context ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    evidence.push(entry);
  };

  const workflowArguments = workflowJobArguments(doc);
  for (const job of doc.jobs) {
    const parameters = {
      ...jobParameterDefaults(job),
      ...stringValues(workflowArguments.get(job.name)),
    };
    for (const step of job.steps) {
      if (step.type === "setup_remote_docker") {
        add({ reason: "setup_remote_docker" });
        continue;
      }
      if (!step.type.includes("/")) {
        continue;
      }
      const fromArgs = evidenceFromArgs(step.node, parameters);
      if (fromArgs) {
        add(fromArgs);
      }
    }
  }
  for (const entry of workflowJobEntries(doc)) {
    const fromArgs = evidenceFromArgs(entry.args, stringValues(entry.args));
    if (fromArgs) {
      add(fromArgs);
    }
  }
  return evidence;
}

export function circleCiHasDockerBuildEvidence(doc: CircleCiDocument): boolean {
  return collectCircleCiDockerEvidence(doc).length > 0;
}

/** True when a non-special orb step/job still hides its command body. */
export function circleCiHasOpaqueOrbSignal(doc: CircleCiDocument): boolean {
  const aliases = orbAliases(doc);
  if (aliases.size === 0) {
    return false;
  }
  for (const job of doc.jobs) {
    for (const step of job.steps) {
      if (!step.orbUnresolved || !step.type.includes("/")) {
        continue;
      }
      const alias = step.type.slice(0, step.type.indexOf("/"));
      if (aliases.has(alias)) {
        return true;
      }
    }
  }
  return workflowJobEntries(doc).some((entry) => aliases.has(entry.alias));
}
