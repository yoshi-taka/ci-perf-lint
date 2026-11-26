import { isMap, isScalar, isSeq, type Node, type YAMLMap } from "./yaml.ts";
import type { CircleCiDocument } from "./circleci-workflow.ts";

const SPECIAL_ORBS = new Set(["circleci/continuation", "circleci/path-filtering"]);

export interface CircleCiGradleOrbInvocation {
  readonly jobName: string;
  readonly node: Node | undefined;
  readonly alias: string;
  readonly reference: string;
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

function mapAt(map: YAMLMap<unknown, unknown> | undefined, key: string) {
  if (!map) {
    return undefined;
  }
  const value = map.get(key, true);
  return isMap(value) ? value : undefined;
}

function orbPathPart(reference: string): string {
  const at = reference.lastIndexOf("@");
  return at > 0 ? reference.slice(0, at) : reference;
}

function nodeContainsGradle(reference: string): boolean {
  const pathPart = orbPathPart(reference);
  const name = pathPart.split("/").pop() ?? pathPart;
  return /gradle/i.test(name);
}

function gradleOrbAliases(doc: CircleCiDocument): Map<string, string> {
  const aliases = new Map<string, string>();
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
    const pathPart = orbPathPart(reference);
    if (SPECIAL_ORBS.has(pathPart)) {
      continue;
    }
    if (/gradle/i.test(alias) || nodeContainsGradle(reference)) {
      aliases.set(alias, reference);
    }
  }
  return aliases;
}

function workflowJobEntries(doc: CircleCiDocument): { name: string; alias: string; node: Node }[] {
  const entries: { name: string; alias: string; node: Node }[] = [];
  const workflows = mapAt(doc.root, "workflows");
  if (!workflows) {
    return entries;
  }
  for (const workflowPair of workflows.items) {
    if (isScalar(workflowPair.key) && scalarValue(workflowPair.key) === "version") {
      continue;
    }
    const workflow = isMap(workflowPair.value) ? workflowPair.value : undefined;
    const jobs = workflow?.get("jobs", true);
    if (!workflow || !isSeq(jobs)) {
      continue;
    }
    for (const item of jobs.items) {
      if (isScalar(item)) {
        const name = scalarValue(item);
        const slash = name?.indexOf("/") ?? -1;
        if (name && slash > 0) {
          entries.push({ name, alias: name.slice(0, slash), node: item });
        }
        continue;
      }
      if (!isMap(item)) {
        continue;
      }
      const pair = item.items[0];
      const name = scalarValue(pair?.key);
      const slash = name?.indexOf("/") ?? -1;
      if (name && slash > 0) {
        entries.push({ name, alias: name.slice(0, slash), node: item });
      }
    }
  }
  return entries;
}

/** CircleCI jobs that invoke an orb whose alias or name identifies Gradle. */
export function collectCircleCiGradleOrbInvocations(
  doc: CircleCiDocument,
): CircleCiGradleOrbInvocation[] {
  const aliases = gradleOrbAliases(doc);
  if (aliases.size === 0) {
    return [];
  }
  const invocations = new Map<string, CircleCiGradleOrbInvocation>();
  const add = (jobName: string, alias: string, node: Node | undefined) => {
    if (invocations.has(jobName)) {
      return;
    }
    const reference = aliases.get(alias);
    if (!reference) {
      return;
    }
    invocations.set(jobName, { jobName, node, alias, reference });
  };

  for (const job of doc.jobs) {
    for (const step of job.steps) {
      const slash = step.type.indexOf("/");
      if (slash <= 0) {
        continue;
      }
      add(job.name, step.type.slice(0, slash), step.invocationNode ?? step.node);
    }
  }
  for (const entry of workflowJobEntries(doc)) {
    add(entry.name, entry.alias, entry.node);
  }
  return [...invocations.values()];
}

export function circleCiHasGradleOrbEvidence(doc: CircleCiDocument): boolean {
  return collectCircleCiGradleOrbInvocations(doc).length > 0;
}
