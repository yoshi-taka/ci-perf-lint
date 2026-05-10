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
const MAX_GITLAB_SOURCE_BYTES = 5_000_000;
const MAX_GITLAB_JOBS = 500;
const MAX_GITLAB_STEPS_PER_JOB = 2_000;

function parseTimingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

const RESERVED_GLOBAL_KEYS = new Set([
  "default",
  "include",
  "stages",
  "types",
  "variables",
  "workflow",
  "cache",
  "image",
  "services",
  "before_script",
  "after_script",
  "spec",
  "integration",
  "review",
]);

export interface GitlabCiJob {
  node: YAMLMap<unknown, unknown>;
  name: string;
  nameNode?: Node;
  stage?: string;
  stageNode?: Node;
  script?: string[];
  scriptNode?: Node;
  image?: string;
  imageNode?: Node;
  timeout?: string;
  timeoutNode?: Node;
  tags?: string[];
  tagsNode?: Node;
  needs?: string[];
  needsNode?: Node;
  parallel?: number;
  parallelNode?: Node;
  interruptible?: boolean;
  interruptibleNode?: Node;
  extends?: string | string[];
  extendsNode?: Node;
  allowFailure?: boolean;
  allowFailureNode?: Node;
}

export interface GitlabCiDocument {
  readonly kind: "gitlab-ci";
  path: string;
  relativePath: string;
  source?: string;
  parsed?: Record<string, unknown>;
  lineCounter?: LineCounter;
  root?: YAMLMap<unknown, unknown>;
  name?: string;
  stages?: string[];
  stagesNode?: Node;
  variables?: Record<string, unknown>;
  variablesNode?: YAMLMap<unknown, unknown>;
  default?: Record<string, unknown>;
  defaultNode?: YAMLMap<unknown, unknown>;
  cache?: Record<string, unknown>;
  cacheNode?: YAMLMap<unknown, unknown>;
  jobs: GitlabCiJob[];
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
  return node && isMap(node) ? node : undefined;
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

function getScalarOrStringArray(node: Node | undefined): string | string[] | undefined {
  const single = getScalarString(node);
  if (single !== undefined) {
    return single;
  }
  return getScalarArray(node);
}

function getBool(node: Node | undefined): boolean | undefined {
  const str = getScalarString(node);
  if (str === undefined) {
    return undefined;
  }
  if (str === "true" || str === "yes") {
    return true;
  }
  if (str === "false" || str === "no") {
    return false;
  }
  return undefined;
}

function parseJob(item: YAMLMap<unknown, unknown>, jobName: string): GitlabCiJob {
  const stageNode = getNode(item, "stage");
  const scriptNode = getNode(item, "script");
  const imageNode = getNode(item, "image");
  const timeoutNode = getNode(item, "timeout");
  const tagsNode = getNode(item, "tags");
  const needsNode = getNode(item, "needs");
  const parallelNode = getNode(item, "parallel");
  const interruptibleNode = getNode(item, "interruptible");
  const extendsNode = getNode(item, "extends");
  const allowFailureNode = getNode(item, "allow_failure");

  const parallelValue = getScalarString(parallelNode);
  const parallelNum = parallelValue ? parseInt(parallelValue, 10) : undefined;

  return {
    node: item,
    name: jobName,
    nameNode: isNode(item) ? undefined : undefined,
    stage: getScalarString(stageNode),
    stageNode,
    script: getScalarArray(scriptNode),
    scriptNode,
    image: getScalarString(imageNode),
    imageNode,
    timeout: getScalarString(timeoutNode),
    timeoutNode,
    tags: getScalarArray(tagsNode),
    tagsNode,
    needs: getScalarArray(needsNode),
    needsNode,
    parallel: isNaN(parallelNum ?? NaN) ? undefined : parallelNum,
    parallelNode,
    interruptible: getBool(interruptibleNode),
    interruptibleNode,
    extends: getScalarOrStringArray(extendsNode),
    extendsNode,
    allowFailure: getBool(allowFailureNode),
    allowFailureNode,
  };
}

export function parseGitlabCi(
  fullPath: string,
  repoRoot: string,
  source: string,
): GitlabCiDocument {
  if (source.length > MAX_GITLAB_SOURCE_BYTES) {
    throw new Error(`GitLab CI source too large: ${fullPath}`);
  }

  const relativePath = path.relative(repoRoot, fullPath) || path.basename(fullPath);
  const startedAt = performance.now();
  const lineCounter = new LineCounter();
  let yamlDocument: Document.Parsed;
  try {
    yamlDocument = parseDocument(source, { lineCounter });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse GitLab CI config ${relativePath}: ${detail}`);
  }

  if (yamlDocument.errors.length > 0) {
    const firstError = yamlDocument.errors[0];
    const detail = firstError instanceof Error ? firstError.message : "unknown YAML error";
    throw new Error(`Failed to parse GitLab CI config ${relativePath}: ${detail}`);
  }
  const parseDocumentElapsedMs = performance.now() - startedAt;

  if (!yamlDocument.contents || !isMap(yamlDocument.contents)) {
    throw new Error(`Expected mapping in ${fullPath}`);
  }

  const root = yamlDocument.contents;
  const getParsed = lazyNodeRecord(root);
  const stagesNode = getNode(root, "stages");
  const variablesNode = getMap(getNode(root, "variables"));
  const defaultNode = getMap(getNode(root, "default"));
  const cacheNode = getMap(getNode(root, "cache"));

  const stages = getScalarArray(stagesNode);

  const jobs: GitlabCiJob[] = [];
  for (const item of root.items) {
    if (jobs.length >= MAX_GITLAB_JOBS) {
      throw new Error(`GitLab CI job limit exceeded in ${relativePath}`);
    }

    const key = getScalarString(item.key);
    if (!key || RESERVED_GLOBAL_KEYS.has(key)) {
      continue;
    }
    if (!item.value || !isMap(item.value)) {
      continue;
    }

    const job = parseJob(item.value, key);
    if ((job.script?.length ?? 0) > MAX_GITLAB_STEPS_PER_JOB) {
      throw new Error(`GitLab CI script step limit exceeded in ${relativePath} job ${key}`);
    }
    jobs.push(job);
  }

  if (parseTimingsEnabled()) {
    process.stderr.write(
      `[timing] parseGitlabCi ${relativePath} parseDocument=${parseDocumentElapsedMs.toFixed(1)}ms buildAst=${(performance.now() - startedAt - parseDocumentElapsedMs).toFixed(1)}ms jobs=${jobs.length}\n`,
    );
  }

  return {
    kind: "gitlab-ci",
    path: fullPath,
    relativePath,
    source,
    get parsed() {
      return getParsed();
    },
    lineCounter,
    root,
    stages,
    stagesNode,
    variables: variablesNode ? nodeToRecord(variablesNode) : undefined,
    variablesNode,
    default: defaultNode ? nodeToRecord(defaultNode) : undefined,
    defaultNode,
    cache: cacheNode ? nodeToRecord(cacheNode) : undefined,
    cacheNode,
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

export function getGitlabCiLocation(
  doc: GitlabCiDocument,
  node: YamlNode | undefined,
): SourceLocation {
  const start = getNodeStart(node);
  if (start === null) {
    return { path: doc.relativePath, line: 1, column: 1 };
  }
  const position = doc.lineCounter?.linePos(start);
  if (!position) {
    return { path: doc.relativePath, line: 1, column: 1 };
  }
  return { path: doc.relativePath, line: position.line, column: position.col };
}
