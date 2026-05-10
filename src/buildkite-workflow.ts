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
import { lazyNodeRecord, nodeToRecord } from "./lazy-node-record.ts";
import type { SourceLocation } from "./types.ts";

type YamlNode = Node | Pair<unknown, unknown>;

const yamlMapPairIndexCache = new WeakMap<
  YAMLMap<unknown, unknown>,
  Map<string, Pair<unknown, unknown>>
>();
const MAX_PIPELINE_SOURCE_BYTES = 5_000_000;
const MAX_PIPELINE_STEPS = 5_000;

function parseTimingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

export interface PipelineStep {
  node: YAMLMap<unknown, unknown>;
  label?: string;
  labelNode?: Node;
  command?: string;
  commandNode?: Node;
  commands?: string[];
  commandsNode?: Node;
  key?: string;
  keyNode?: Node;
  if?: string;
  ifNode?: Node;
  timeoutNode?: Node;
  plugins?: Record<string, unknown>[];
  pluginsNode?: YAMLMap<unknown, unknown>;
  env?: Record<string, unknown>;
  envNode?: YAMLMap<unknown, unknown>;
  agents?: Record<string, unknown>;
  agentsNode?: YAMLMap<unknown, unknown>;
  branches?: string;
  branchesNode?: Node;
  dependsOn?: string | string[];
  dependsOnNode?: Node;
  parallelism?: number;
  parallelismNode?: Node;
  retry?: Record<string, unknown>;
  retryNode?: YAMLMap<unknown, unknown>;
  skip?: string | boolean;
  skipNode?: Node;
  ifChanged?: string | string[];
  ifChangedNode?: Node;
  isWait: boolean;
  isBlock: boolean;
  isTrigger: boolean;
  isGroup: boolean;
}

export interface PipelineDocument {
  path: string;
  relativePath: string;
  source?: string;
  parsed?: Record<string, unknown>;
  lineCounter?: LineCounter;
  root?: YAMLMap<unknown, unknown>;
  name?: string;
  nameNode?: Node;
  env?: Record<string, unknown>;
  envNode?: YAMLMap<unknown, unknown>;
  agents?: Record<string, unknown>;
  agentsNode?: YAMLMap<unknown, unknown>;
  stepsNode?: Node;
  steps: PipelineStep[];
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

function getPair(map: YAMLMap<unknown, unknown>, key: string): Pair<unknown, unknown> | undefined {
  return getPairIndex(map).get(key);
}

function getNode(map: YAMLMap<unknown, unknown>, key: string): Node | undefined {
  const pair = getPair(map, key);
  return isNode(pair?.value) ? pair.value : undefined;
}

function getScalarString(value: unknown): string | undefined {
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

function getScalarArray(node: Node | undefined): string[] | undefined {
  if (!node || !isSeq(node)) {
    return undefined;
  }

  const values: string[] = [];
  for (const item of node.items) {
    const str = getScalarString(item);
    if (str !== undefined) {
      values.push(str);
    }
  }
  return values.length > 0 ? values : undefined;
}

function parsePlugins(node: Node | undefined): Record<string, unknown>[] | undefined {
  if (!node || !isSeq(node)) {
    return undefined;
  }

  const plugins: Record<string, unknown>[] = [];
  for (const item of node.items) {
    if (!item) {
      continue;
    }
    const value = isNode(item) ? item.toJSON() : item;
    const record = nodeToRecord(value as Node);
    if (record) {
      plugins.push(record);
    }
  }
  return plugins.length > 0 ? plugins : undefined;
}

function parseStep(item: unknown): PipelineStep {
  if (!isMap(item)) {
    return {
      node: item as YAMLMap<unknown, unknown>,
      isWait: false,
      isBlock: false,
      isTrigger: false,
      isGroup: false,
    };
  }

  const labelNode = getNode(item, "label") ?? getNode(item, "name");
  const commandNode = getNode(item, "command");
  const commandsNode = getNode(item, "commands");
  const keyNode = getNode(item, "key") ?? getNode(item, "id") ?? getNode(item, "identifier");
  const ifNode = getNode(item, "if");
  const timeoutNode = getNode(item, "timeout_in_minutes");
  const pluginsNode = getMap(getNode(item, "plugins"));
  const envNode = getMap(getNode(item, "env"));
  const agentsNode = getMap(getNode(item, "agents"));
  const branchesNode = getNode(item, "branches");
  const dependsOnNode = getNode(item, "depends_on");
  const parallelismNode = getNode(item, "parallelism");
  const retryNode = getMap(getNode(item, "retry"));
  const skipNode = getNode(item, "skip");
  const ifChangedNode = getNode(item, "if_changed");

  const waitNode = getNode(item, "wait");
  const blockNode = getNode(item, "block");
  const triggerNode = getNode(item, "trigger");
  const groupNode = getNode(item, "group");

  const parallelismValue = getScalarString(parallelismNode);
  const parallelismNum = parallelismValue ? parseInt(parallelismValue, 10) : undefined;

  const skipValue = getScalarString(skipNode);
  const skipResult =
    skipValue !== undefined
      ? skipValue === "" || skipValue.toLowerCase() === "false"
        ? false
        : skipValue === "true"
          ? true
          : skipValue
      : undefined;

  const commandScalar = getScalarString(commandNode);
  const commandArray = commandScalar !== undefined ? undefined : getScalarArray(commandNode);
  return {
    node: item,
    label: getScalarString(labelNode),
    labelNode,
    command: commandScalar,
    commandNode,
    commands: commandArray ?? getScalarArray(commandsNode),
    commandsNode: commandArray !== undefined ? commandNode : commandsNode,
    key: getScalarString(keyNode),
    keyNode,
    if: getScalarString(ifNode),
    ifNode,
    timeoutNode,
    plugins: pluginsNode ? parsePlugins(pluginsNode) : undefined,
    pluginsNode,
    env: envNode ? nodeToRecord(envNode) : undefined,
    envNode,
    agents: agentsNode ? nodeToRecord(agentsNode) : undefined,
    agentsNode,
    branches: getScalarString(branchesNode),
    branchesNode,
    dependsOn: getScalarString(dependsOnNode) ?? getScalarArray(dependsOnNode),
    dependsOnNode,
    parallelism: isNaN(parallelismNum ?? NaN) ? undefined : parallelismNum,
    parallelismNode,
    retry: retryNode ? nodeToRecord(retryNode) : undefined,
    retryNode,
    skip: skipResult,
    skipNode,
    ifChanged: getScalarString(ifChangedNode) ?? getScalarArray(ifChangedNode),
    ifChangedNode,
    isWait: waitNode !== undefined,
    isBlock: blockNode !== undefined,
    isTrigger: triggerNode !== undefined,
    isGroup: groupNode !== undefined,
  };
}

function parseSteps(node: Node | undefined): PipelineStep[] {
  if (!node || !isSeq(node)) {
    return [];
  }

  const steps: PipelineStep[] = [];

  for (const item of node.items) {
    if (!item) {
      continue;
    }

    steps.push(parseStep(item));
  }

  return steps;
}

export function parsePipeline(
  fullPath: string,
  repoRoot: string,
  source: string,
): PipelineDocument {
  if (source.length > MAX_PIPELINE_SOURCE_BYTES) {
    throw new Error(`Pipeline source too large: ${fullPath}`);
  }

  const relativePath = path.relative(repoRoot, fullPath) || path.basename(fullPath);
  const startedAt = performance.now();
  const lineCounter = new LineCounter();
  let yamlDocument: Document.Parsed;
  try {
    yamlDocument = parseDocument(source, { lineCounter });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse pipeline ${relativePath}: ${detail}`);
  }

  if (yamlDocument.errors.length > 0) {
    const firstError = yamlDocument.errors[0];
    const detail = firstError instanceof Error ? firstError.message : "unknown YAML error";
    throw new Error(`Failed to parse pipeline ${relativePath}: ${detail}`);
  }
  const parseDocumentElapsedMs = performance.now() - startedAt;

  if (!yamlDocument.contents) {
    throw new Error(`Expected pipeline content in ${fullPath}`);
  }

  if (!isMap(yamlDocument.contents) && !isSeq(yamlDocument.contents)) {
    throw new Error(`Expected pipeline mapping or sequence in ${fullPath}`);
  }

  let stepsNode: Node | undefined;
  let root: YAMLMap<unknown, unknown> | undefined;
  const rootSeq = isSeq(yamlDocument.contents) ? yamlDocument.contents : undefined;

  if (isMap(yamlDocument.contents)) {
    root = yamlDocument.contents;
    stepsNode = getNode(root, "steps");
  }
  stepsNode ??= rootSeq;

  const getParsed = root ? lazyNodeRecord(root) : () => ({});
  const steps = parseSteps(stepsNode);
  if (steps.length > MAX_PIPELINE_STEPS) {
    throw new Error(`Pipeline step limit exceeded in ${relativePath}`);
  }
  const nameNode = root ? getNode(root, "name") : undefined;
  const envNode = root ? getMap(getNode(root, "env")) : undefined;
  const agentsNode = root ? getMap(getNode(root, "agents")) : undefined;

  if (parseTimingsEnabled()) {
    process.stderr.write(
      `[timing] parsePipeline ${relativePath} parseDocument=${parseDocumentElapsedMs.toFixed(1)}ms buildAst=${(performance.now() - startedAt - parseDocumentElapsedMs).toFixed(1)}ms steps=${steps.length}\n`,
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
    name: root ? getScalarString(nameNode) : undefined,
    nameNode,
    env: envNode ? nodeToRecord(envNode) : undefined,
    envNode,
    agents: agentsNode ? nodeToRecord(agentsNode) : undefined,
    agentsNode,
    stepsNode,
    steps,
  };
}

function getNodeStart(node: YamlNode | undefined): number | null {
  if (!node || !isNode(node) || !Array.isArray(node.range)) {
    return null;
  }

  const start = node.range[0];
  return typeof start === "number" ? start : null;
}

export function getPipelineLocation(
  pipeline: PipelineDocument,
  node: YamlNode | undefined,
): SourceLocation {
  const start = getNodeStart(node);
  if (start === null) {
    return {
      path: pipeline.relativePath,
      line: 1,
      column: 1,
    };
  }

  const position = pipeline.lineCounter?.linePos(start);
  if (!position) {
    return {
      path: pipeline.relativePath,
      line: 1,
      column: 1,
    };
  }
  return {
    path: pipeline.relativePath,
    line: position.line,
    column: position.col,
  };
}
