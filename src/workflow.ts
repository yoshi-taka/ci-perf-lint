import path from "node:path";
import {
  LineCounter,
  parseDocument,
  type Document,
  type Node,
  type Pair,
  type YAMLMap,
  isMap,
  isNode,
  isScalar,
  isSeq,
} from "yaml";
import { lazyNodeRecord, lazyOptionalNodeRecord } from "./lazy-node-record.ts";
import type { SourceLocation } from "./types.ts";

type YamlNode = Node | Pair<unknown, unknown>;

const yamlMapPairIndexCache = new WeakMap<
  YAMLMap<unknown, unknown>,
  Map<string, Pair<unknown, unknown>>
>();

const CACHE_THRESHOLD = 5;
const MAX_WORKFLOW_SOURCE_BYTES = 5_000_000;
const MAX_WORKFLOW_JOBS = 500;
const MAX_WORKFLOW_STEPS_PER_JOB = 2_000;

function parseTimingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

export interface WorkflowStep {
  node: YAMLMap<unknown, unknown>;
  name?: string;
  nameNode?: Node;
  uses?: string;
  usesNode?: Node;
  run?: string;
  runNode?: Node;
  if?: string;
  ifNode?: Node;
  timeoutNode?: Node;
  with?: Record<string, unknown>;
  withNode?: YAMLMap<unknown, unknown>;
  workingDirectory?: string;
  workingDirectoryNode?: Node;
}

export interface WorkflowJob {
  id: string;
  idNode?: Node;
  node: YAMLMap<unknown, unknown>;
  raw: Record<string, unknown>;
  steps: WorkflowStep[];
  hasIf: boolean;
  ifNode?: Node;
  usesReusableWorkflow: boolean;
  concurrencyNode?: Node;
}

export interface WorkflowDocument {
  path: string;
  relativePath: string;
  source?: string;
  parsed?: Record<string, unknown>;
  lineCounter?: LineCounter;
  root?: YAMLMap<unknown, unknown>;
  name?: string;
  nameNode?: Node;
  on?: unknown;
  onNode?: Node;
  concurrencyNode?: Node;
  jobsNode?: YAMLMap<unknown, unknown>;
  jobs: WorkflowJob[];
}

function getPair(map: YAMLMap<unknown, unknown>, key: string): Pair<unknown, unknown> | undefined {
  if (map.items.length <= CACHE_THRESHOLD) {
    for (const item of map.items) {
      if (getScalarString(item.key) === key) {
        return item;
      }
    }
    return undefined;
  }
  return getPairIndex(map).get(key);
}

function getPairIndex(map: YAMLMap<unknown, unknown>): Map<string, Pair<unknown, unknown>> {
  const cached = yamlMapPairIndexCache.get(map);
  if (cached) {
    return cached;
  }

  const index = new Map<string, Pair<unknown, unknown>>();
  for (const item of map.items) {
    const key = getScalarString(item.key);
    if (key !== undefined) {
      index.set(key, item);
    }
  }

  yamlMapPairIndexCache.set(map, index);
  return index;
}

export function getNode(map: YAMLMap<unknown, unknown>, key: string): Node | undefined {
  const pair = getPair(map, key);
  return isNode(pair?.value) ? pair.value : undefined;
}

export function getScalarValue(
  map: YAMLMap<unknown, unknown>,
  key: string,
): string | number | boolean | undefined {
  const pair = getPair(map, key);
  if (!pair || !isScalar(pair.value)) {
    return undefined;
  }
  const { value } = pair.value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

export function getMapValue(
  map: YAMLMap<unknown, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const node = getNode(map, key);
  if (!node) {
    return undefined;
  }
  const value = node.toJSON();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function getStringOrArrayValue(
  map: YAMLMap<unknown, unknown>,
  key: string,
): string | unknown[] | undefined {
  const pair = getPair(map, key);
  if (!pair) {
    return undefined;
  }
  const node = pair.value;
  if (isScalar(node)) {
    const { value } = node;
    if (typeof value === "string") {
      return value;
    }
  }
  if (isSeq(node)) {
    return node.toJSON();
  }
  return undefined;
}

export function getScalarString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (isScalar(value) && typeof value.value === "string") {
    return value.value;
  }

  return undefined;
}

function getMap(node: Node | undefined): YAMLMap<unknown, unknown> | undefined {
  if (node && isMap(node)) {
    return node;
  }
  return undefined;
}

function parseSteps(node: Node | undefined): WorkflowStep[] {
  if (!node || !isSeq(node)) {
    return [];
  }

  const steps: WorkflowStep[] = [];

  for (const item of node.items) {
    if (!item || !isMap(item)) {
      continue;
    }

    const nameNode = getNode(item, "name");
    const usesNode = getNode(item, "uses");
    const runNode = getNode(item, "run");
    const ifNode = getNode(item, "if");
    const timeoutNode = getNode(item, "timeout-minutes");
    const withNode = getNode(item, "with");
    const workingDirectoryNode = getNode(item, "working-directory");
    const getWith = lazyOptionalNodeRecord(withNode);

    steps.push({
      node: item,
      name: getScalarString(nameNode),
      nameNode,
      uses: getScalarString(usesNode),
      usesNode,
      run: getScalarString(runNode),
      runNode,
      if: getScalarString(ifNode),
      ifNode,
      timeoutNode,
      get with() {
        return getWith();
      },
      withNode: getMap(withNode),
      workingDirectory: getScalarString(workingDirectoryNode),
      workingDirectoryNode,
    });
  }

  return steps;
}

export function parseWorkflow(
  fullPath: string,
  repoRoot: string,
  source: string,
): WorkflowDocument {
  if (source.length > MAX_WORKFLOW_SOURCE_BYTES) {
    throw new Error(`Workflow source too large: ${fullPath}`);
  }

  const relativePath = path.relative(repoRoot, fullPath) || path.basename(fullPath);
  const startedAt = performance.now();
  const lineCounter = new LineCounter();
  let yamlDocument: Document.Parsed;
  try {
    yamlDocument = parseDocument(source, { lineCounter });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse workflow ${relativePath}: ${detail}`);
  }

  if (yamlDocument.errors.length > 0) {
    const firstError = yamlDocument.errors[0];
    const detail = firstError instanceof Error ? firstError.message : "unknown YAML error";
    throw new Error(`Failed to parse workflow ${relativePath}: ${detail}`);
  }
  const parseDocumentElapsedMs = performance.now() - startedAt;

  if (!yamlDocument.contents || !isMap(yamlDocument.contents)) {
    throw new Error(`Expected workflow mapping in ${fullPath}`);
  }

  const root = yamlDocument.contents;
  const getParsed = lazyNodeRecord(root);
  const jobsNode = getMap(getNode(root, "jobs"));
  const nameNode = getNode(root, "name");
  const onNode = getNode(root, "on");
  const concurrencyNode = getNode(root, "concurrency");
  const jobs: WorkflowJob[] = [];

  for (const item of jobsNode?.items ?? []) {
    if (jobs.length >= MAX_WORKFLOW_JOBS) {
      throw new Error(`Workflow job limit exceeded in ${relativePath}`);
    }

    const jobId = getScalarString(item.key);
    if (!jobId || !item.value || !isMap(item.value)) {
      continue;
    }

    const node = item.value;
    const getRaw = lazyNodeRecord(node);
    const stepsNode = getNode(node, "steps");
    const ifNode = getNode(node, "if");
    const usesNode = getNode(node, "uses");
    const jobConcurrencyNode = getNode(node, "concurrency");
    const steps = parseSteps(stepsNode);
    if (steps.length > MAX_WORKFLOW_STEPS_PER_JOB) {
      throw new Error(`Workflow step limit exceeded in ${relativePath} job ${jobId}`);
    }
    jobs.push({
      id: jobId,
      idNode: isNode(item.key) ? item.key : undefined,
      node,
      get raw() {
        return getRaw();
      },
      steps,
      hasIf: Boolean(getScalarString(ifNode)),
      ifNode,
      usesReusableWorkflow: Boolean(getScalarString(usesNode)),
      concurrencyNode: jobConcurrencyNode,
    });
  }

  if (parseTimingsEnabled()) {
    process.stderr.write(
      `[timing] parseWorkflow ${relativePath} parseDocument=${parseDocumentElapsedMs.toFixed(1)}ms buildAst=${(performance.now() - startedAt - parseDocumentElapsedMs).toFixed(1)}ms jobs=${jobs.length}\n`,
    );
  }

  return {
    path: fullPath,
    relativePath,
    source,
    get parsed() {
      return getParsed();
    },
    lineCounter,
    root,
    name: getScalarString(nameNode),
    nameNode,
    get on() {
      return getParsed().on;
    },
    onNode,
    concurrencyNode,
    jobsNode,
    jobs,
  };
}

function getNodeStart(node: YamlNode | undefined): number | null {
  if (!node || !isNode(node) || !Array.isArray(node.range)) {
    return null;
  }

  const start = node.range[0];
  return typeof start === "number" ? start : null;
}

export function getLocation(
  workflow: WorkflowDocument,
  node: YamlNode | undefined,
): SourceLocation {
  const start = getNodeStart(node);
  if (start === null) {
    return {
      path: workflow.relativePath,
      line: 1,
      column: 1,
    };
  }

  const position = workflow.lineCounter?.linePos(start);
  if (!position) {
    return {
      path: workflow.relativePath,
      line: 1,
      column: 1,
    };
  }
  return {
    path: workflow.relativePath,
    line: position.line,
    column: position.col,
  };
}
