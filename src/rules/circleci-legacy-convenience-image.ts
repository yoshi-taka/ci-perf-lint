import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CircleCiDocument, CircleCiJob } from "../circleci-workflow.ts";
import { isMap, isNode, isScalar, isSeq, type Node, type YAMLMap } from "../yaml.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "circleci-legacy-convenience-image",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/circleci-legacy-convenience-image.md",
  scope: "circleci",
} satisfies RuleMeta;

const LEGACY_NAMES = new Set([
  "node",
  "python",
  "ruby",
  "openjdk",
  "golang",
  "php",
  "rust",
  "elixir",
  "clojure",
  "android",
  "postgres",
  "mysql",
  "mariadb",
  "redis",
  "mongo",
  "buildpack-deps",
  "jruby",
  "dynamodb",
]);
const NEXT_GEN_RENAMES = new Map([
  ["golang", "go"],
  ["buildpack-deps", "base"],
]);
const NO_NEXT_GEN = new Set(["jruby", "dynamodb", "mongo"]);
const BROWSER_SUFFIX = /-(?:node-)?browsers(?:-legacy)?$/i;
const IMAGE_PATTERN = /^(?:docker\.io\/)?circleci\/([a-z0-9._-]+)(?::([^@\s]+))?(?:@[^\s]+)?$/i;

interface LegacyImage {
  readonly name: string;
  readonly tag?: string;
}

interface ImageReference {
  readonly node: Node;
  readonly image: string;
  readonly jobs: Set<string>;
}

function scalarString(value: unknown): string | undefined {
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
  const value = nodeAt(map, key);
  return isMap(value) ? value : undefined;
}

function parameterDefaults(node: YAMLMap<unknown, unknown> | undefined): Map<string, string> {
  const defaults = new Map<string, string>();
  const parameters = node ? mapAt(node, "parameters") : undefined;
  if (!parameters) {
    return defaults;
  }
  for (const pair of parameters.items) {
    const name = scalarString(pair.key);
    const definition = isMap(pair.value) ? pair.value : undefined;
    const defaultValue = definition ? scalarString(definition.get("default", true)) : undefined;
    if (name && defaultValue !== undefined) {
      defaults.set(name, defaultValue);
    }
  }
  return defaults;
}

function resolveTemplate(
  value: string,
  parameters: ReadonlyMap<string, string>,
): string | undefined {
  const resolved = value.replace(
    /<<\s*parameters\.([A-Za-z0-9_-]+)\s*>>/g,
    (match, name: string) => parameters.get(name) ?? match,
  );
  return /<<\s*parameters\./.test(resolved) ? undefined : resolved;
}

function collectImageNodes(
  dockerNode: Node | undefined,
  parameters: ReadonlyMap<string, string>,
  add: (node: Node, image: string) => void,
): void {
  if (!dockerNode || !isSeq(dockerNode)) {
    return;
  }
  for (const item of dockerNode.items) {
    const imageNode = isMap(item) ? nodeAt(item, "image") : isNode(item) ? item : undefined;
    if (!imageNode) {
      continue;
    }
    const raw = scalarString(imageNode);
    if (!raw) {
      continue;
    }
    const image = resolveTemplate(raw, parameters);
    if (image) {
      add(imageNode, image);
    }
  }
}

function executorDefinitions(
  doc: CircleCiDocument,
): Map<string, { node: YAMLMap<unknown, unknown>; defaults: Map<string, string> }> {
  const definitions = new Map<
    string,
    { node: YAMLMap<unknown, unknown>; defaults: Map<string, string> }
  >();
  const executors = doc.root ? mapAt(doc.root, "executors") : undefined;
  for (const pair of executors?.items ?? []) {
    const name = scalarString(pair.key);
    if (!name || !isMap(pair.value)) {
      continue;
    }
    definitions.set(name, { node: pair.value, defaults: parameterDefaults(pair.value) });
  }
  return definitions;
}

function jobExecutor(
  job: CircleCiJob,
  executors: ReturnType<typeof executorDefinitions>,
): { dockerNode: Node | undefined; parameters: Map<string, string> } {
  const jobDefaults = parameterDefaults(job.node);
  const executorNode = nodeAt(job.node, "executor");
  if (!executorNode) {
    return { dockerNode: nodeAt(job.node, "docker"), parameters: jobDefaults };
  }
  if (isScalar(executorNode)) {
    const name = scalarString(executorNode);
    const definition = name ? executors.get(name) : undefined;
    return {
      dockerNode: definition ? nodeAt(definition.node, "docker") : undefined,
      parameters: definition ? new Map(definition.defaults) : new Map(),
    };
  }
  if (!isMap(executorNode)) {
    return { dockerNode: nodeAt(job.node, "docker"), parameters: jobDefaults };
  }
  const name = scalarString(executorNode.get("name", true));
  const definition = name ? executors.get(name) : undefined;
  const parameters = new Map(definition?.defaults ?? []);
  for (const pair of executorNode.items) {
    const key = scalarString(pair.key);
    if (!key || key === "name") {
      continue;
    }
    const raw = scalarString(pair.value);
    const value = raw === undefined ? undefined : resolveTemplate(raw, jobDefaults);
    if (key && value !== undefined) {
      parameters.set(key, value);
    }
  }
  return {
    dockerNode: definition ? nodeAt(definition.node, "docker") : mapAt(executorNode, "docker"),
    parameters,
  };
}

function legacyImage(image: string): LegacyImage | undefined {
  const match = IMAGE_PATTERN.exec(image.trim());
  if (!match) {
    return undefined;
  }
  const name = match[1]!.toLowerCase();
  if (!LEGACY_NAMES.has(name)) {
    return undefined;
  }
  return { name, tag: match[2] };
}

function replacementText(image: LegacyImage): string {
  if (NO_NEXT_GEN.has(image.name)) {
    return `There is no next-gen equivalent; use a third-party image or install ${image.name} on cimg/base.`;
  }
  const target = NEXT_GEN_RENAMES.get(image.name) ?? image.name;
  if (image.tag && BROWSER_SUFFIX.test(image.tag)) {
    const version = image.tag.replace(BROWSER_SUFFIX, "");
    return `Replace it with cimg/${target}:${version}-browsers and add the circleci/browser-tools orb; browsers are no longer preinstalled.`;
  }
  const tag = image.tag ? `:${image.tag}` : "";
  return `Replace it with cimg/${target}${tag}. If cimg does not publish this tag, choose the nearest supported version.`;
}

export const circleciLegacyConvenienceImageRule = {
  meta,
  check(doc: CircleCiDocument, _context: RuleContext): Diagnostic[] {
    if (!doc.root) {
      return [];
    }
    const references = new Map<string, ImageReference>();
    const add = (jobName: string, node: Node, image: string) => {
      const start = Array.isArray(node.range) ? node.range[0] : 0;
      const key = `${start}\0${image}`;
      const existing = references.get(key);
      if (existing) {
        existing.jobs.add(jobName);
      } else {
        references.set(key, { node, image, jobs: new Set([jobName]) });
      }
    };

    const executors = executorDefinitions(doc);
    for (const job of doc.jobs) {
      const { dockerNode, parameters } = jobExecutor(job, executors);
      collectImageNodes(dockerNode, parameters, (node, image) => add(job.name, node, image));
    }

    const findings: Diagnostic[] = [];
    for (const reference of references.values()) {
      const parsed = legacyImage(reference.image);
      if (!parsed) {
        continue;
      }
      const jobs = [...reference.jobs].sort();
      const jobText =
        jobs.length === 1 ? `job "${jobs[0]}"` : `jobs ${jobs.map((job) => `"${job}"`).join(", ")}`;
      findings.push(
        buildDiagnostic(doc, meta, reference.node, {
          message: `Image ${reference.image} is a legacy CircleCI convenience image used by ${jobText}. ${replacementText(parsed)}`,
          why: "CircleCI's next-gen cimg images are designed to be faster, more efficient, and more reliable, and legacy convenience images are being deprecated.",
          suggestion: replacementText(parsed),
          measurementHint:
            'Compare the "Spin up environment" step time and total job time before and after switching images.',
          aiHandoff: `Review ${doc.relativePath}. Replace ${reference.image} for ${jobText} with the suggested cimg image, or a third-party image when no next-gen equivalent exists. Verify the image tag is supported.`,
          score: 52,
        }),
      );
    }
    return findings;
  },
};
