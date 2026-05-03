import path from "node:path";
import {
  LineCounter,
  parseDocument,
  YAMLMap,
  type Document,
  type Node,
  type Pair,
  isMap,
  isNode,
  isScalar,
  isSeq,
} from "yaml";
import type { SourceLocation } from "./types.ts";

type YamlNode = Node | Pair<unknown, unknown>;

const yamlMapPairIndexCache = new WeakMap<
  YAMLMap<unknown, unknown>,
  Map<string, Pair<unknown, unknown>>
>();

const KNOWN_STEP_TYPES = new Set([
  "checkout",
  "run",
  "save_cache",
  "restore_cache",
  "store_artifacts",
  "store_test_results",
  "persist_to_workspace",
  "attach_workspace",
  "add_ssh_keys",
  "setup_remote_docker",
  "when",
  "unless",
]);

interface CircleCiStep {
  node: YAMLMap<unknown, unknown>;
  type: string;
  name?: string;
  nameNode?: Node;
  command?: string;
  commandNode?: Node;
  checkoutMethod?: string;
  checkoutMethodNode?: Node;
  checkoutPath?: string;
  checkoutPathNode?: Node;
  cacheKey?: string;
  cacheKeyNode?: Node;
  cachePaths?: string[];
  cachePathsNode?: Node;
  restoreKeys?: string[];
  restoreKeysNode?: Node;
  artifactPath?: string;
  artifactPathNode?: Node;
  workspaceRoot?: string;
  workspaceRootNode?: Node;
  workspacePaths?: string[];
  workspacePathsNode?: Node;
  attachAt?: string;
  attachAtNode?: Node;
  noOutputTimeout?: string;
  noOutputTimeoutNode?: Node;
  shell?: string;
  workingDirectory?: string;
  background?: boolean;
  backgroundNode?: Node;
  dockerLayerCaching?: boolean;
  dockerLayerCachingNode?: Node;
}

export interface CircleCiJob {
  node: YAMLMap<unknown, unknown>;
  name: string;
  nameNode?: Node;
  dockerImages?: string[];
  resourceClass?: string;
  resourceClassNode?: Node;
  parallelism?: number;
  parallelismNode?: Node;
  environment?: Record<string, unknown>;
  environmentNode?: YAMLMap<unknown, unknown>;
  steps: CircleCiStep[];
}

export interface CircleCiDocument {
  readonly kind: "circleci";
  path: string;
  relativePath: string;
  source?: string;
  parsed?: Record<string, unknown>;
  lineCounter?: LineCounter;
  root?: YAMLMap<unknown, unknown>;
  name?: string;
  version?: string;
  jobs: CircleCiJob[];
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

function getPlainRecord(node: Node | undefined): Record<string, unknown> | undefined {
  if (!node) {
    return undefined;
  }
  const value = node.toJSON();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
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

function parseStepArgs(item: YAMLMap<unknown, unknown>, stepType: string): CircleCiStep {
  const step: CircleCiStep = {
    node: item,
    type: stepType,
  };

  if (stepType === "run") {
    step.name = getScalarString(getNode(item, "name"));
    step.nameNode = getNode(item, "name");
    step.command = getScalarString(getNode(item, "command"));
    step.commandNode = getNode(item, "command");
    step.noOutputTimeout = getScalarString(getNode(item, "no_output_timeout"));
    step.noOutputTimeoutNode = getNode(item, "no_output_timeout");
    step.shell = getScalarString(getNode(item, "shell"));
    step.workingDirectory = getScalarString(getNode(item, "working_directory"));
    step.background = getBool(getNode(item, "background"));
    step.backgroundNode = getNode(item, "background");
  } else if (stepType === "checkout") {
    step.checkoutMethod = getScalarString(getNode(item, "method"));
    step.checkoutMethodNode = getNode(item, "method");
    step.checkoutPath = getScalarString(getNode(item, "path"));
    step.checkoutPathNode = getNode(item, "path");
  } else if (stepType === "save_cache") {
    step.name = getScalarString(getNode(item, "name"));
    step.nameNode = getNode(item, "name");
    step.cacheKey = getScalarString(getNode(item, "key"));
    step.cacheKeyNode = getNode(item, "key");
    step.cachePaths = getScalarArray(getNode(item, "paths"));
    step.cachePathsNode = getNode(item, "paths");
  } else if (stepType === "restore_cache") {
    step.name = getScalarString(getNode(item, "name"));
    step.nameNode = getNode(item, "name");
    step.restoreKeys = getScalarArray(getNode(item, "keys"));
    step.restoreKeysNode = getNode(item, "keys");
  } else if (stepType === "store_artifacts") {
    step.artifactPath = getScalarString(getNode(item, "path"));
    step.artifactPathNode = getNode(item, "path");
  } else if (stepType === "persist_to_workspace") {
    step.workspaceRoot = getScalarString(getNode(item, "root"));
    step.workspaceRootNode = getNode(item, "root");
    step.workspacePaths = getScalarArray(getNode(item, "paths"));
    step.workspacePathsNode = getNode(item, "paths");
  } else if (stepType === "attach_workspace") {
    step.attachAt = getScalarString(getNode(item, "at"));
    step.attachAtNode = getNode(item, "at");
  } else if (stepType === "setup_remote_docker") {
    step.dockerLayerCaching = getBool(getNode(item, "docker_layer_caching"));
    step.dockerLayerCachingNode = getNode(item, "docker_layer_caching");
  }

  return step;
}

function parseSteps(seq: Node | undefined): CircleCiStep[] {
  if (!seq || !isSeq(seq)) {
    return [];
  }
  const steps: CircleCiStep[] = [];
  for (const item of seq.items) {
    if (!item) {
      continue;
    }

    if (isScalar(item)) {
      const name = getScalarString(item);
      if (name && KNOWN_STEP_TYPES.has(name)) {
        const emptyMap = new YAMLMap<unknown, unknown>();
        emptyMap.range = [0, 0, 0];
        steps.push({
          node: emptyMap,
          type: name,
        });
      }
      continue;
    }

    if (!isMap(item)) {
      continue;
    }
    if (item.items.length === 0) {
      continue;
    }

    const first = item.items[0];
    if (!first) {
      continue;
    }

    const stepType = getScalarString(first.key);
    if (!stepType) {
      continue;
    }

    if (isScalar(first.value)) {
      const str = getScalarString(first.value);
      if (str !== undefined && stepType === "run") {
        steps.push({
          node: item,
          type: "run",
          command: str,
          commandNode: isNode(first.value) ? first.value : undefined,
        });
      } else {
        const innerMap = new YAMLMap<unknown, unknown>();
        innerMap.range = [0, 0, 0];
        steps.push({
          node: item,
          type: stepType,
        });
      }
    } else if (isMap(first.value)) {
      steps.push(parseStepArgs(first.value, stepType));
    } else {
      steps.push({
        node: item,
        type: stepType,
      });
    }
  }
  return steps;
}

function lazyNodeRecord(node: Node | undefined): () => Record<string, unknown> {
  let cached: Record<string, unknown> | undefined;
  let loaded = false;
  return () => {
    if (loaded) {
      return cached ?? {};
    }
    loaded = true;
    cached = getPlainRecord(node) ?? {};
    return cached;
  };
}

export function parseCircleCi(
  fullPath: string,
  repoRoot: string,
  source: string,
): CircleCiDocument {
  const relativePath = path.relative(repoRoot, fullPath) || path.basename(fullPath);
  const lineCounter = new LineCounter();
  let yamlDocument: Document.Parsed;
  try {
    yamlDocument = parseDocument(source, {
      lineCounter,
      keepSourceTokens: true,
      prettyErrors: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse CircleCI config ${relativePath}: ${detail}`);
  }

  if (yamlDocument.errors.length > 0) {
    const firstError = yamlDocument.errors[0];
    const detail = firstError instanceof Error ? firstError.message : "unknown YAML error";
    throw new Error(`Failed to parse CircleCI config ${relativePath}: ${detail}`);
  }

  if (!yamlDocument.contents || !isMap(yamlDocument.contents)) {
    throw new Error(`Expected mapping in ${fullPath}`);
  }

  const root = yamlDocument.contents;
  const getParsed = lazyNodeRecord(root);
  const versionNode = getNode(root, "version");
  const jobsNode = getMap(getNode(root, "jobs"));

  const jobs: CircleCiJob[] = [];
  for (const item of jobsNode?.items ?? []) {
    const jobName = getScalarString(item.key);
    if (!jobName || !item.value || !isMap(item.value)) {
      continue;
    }

    const node = item.value;
    const dockerNode = getNode(node, "docker");
    const resourceClassNode = getNode(node, "resource_class");
    const parallelismNode = getNode(node, "parallelism");
    const environmentNode = getMap(getNode(node, "environment"));
    const stepsNode = getNode(node, "steps");

    const dockerImages: string[] = [];
    if (dockerNode && isSeq(dockerNode)) {
      for (const imgItem of dockerNode.items) {
        if (isMap(imgItem)) {
          const img = getScalarString(getNode(imgItem, "image"));
          if (img) {
            dockerImages.push(img);
          }
        } else {
          const img = getScalarString(imgItem);
          if (img) {
            dockerImages.push(img);
          }
        }
      }
    }

    const parallelismValue = getScalarString(parallelismNode);
    const parallelismNum = parallelismValue ? parseInt(parallelismValue, 10) : undefined;

    jobs.push({
      node,
      name: jobName,
      nameNode: isNode(item.key) ? item.key : undefined,
      dockerImages: dockerImages.length > 0 ? dockerImages : undefined,
      resourceClass: getScalarString(resourceClassNode),
      resourceClassNode,
      parallelism: isNaN(parallelismNum ?? NaN) ? undefined : parallelismNum,
      parallelismNode,
      environment: environmentNode ? getPlainRecord(environmentNode) : undefined,
      environmentNode,
      steps: parseSteps(stepsNode),
    });
  }

  return {
    kind: "circleci",
    path: fullPath,
    relativePath,
    source,
    get parsed() {
      return getParsed();
    },
    lineCounter,
    root,
    version: getScalarString(versionNode),
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

export function getCircleCiLocation(
  doc: CircleCiDocument,
  node: YamlNode | undefined,
): SourceLocation {
  const start = getNodeStart(node);
  if (start === null) {
    return { path: doc.relativePath, line: 1, column: 1 };
  }
  const position = doc.lineCounter!.linePos(start);
  return { path: doc.relativePath, line: position.line, column: position.col };
}
