import type { AnalysisWarning } from "./types.ts";
import { isMap, isNode, isScalar, isSeq, type Node, type YAMLMap } from "./yaml.ts";
import { Alias, YAMLSeq } from "./yaml-ast.ts";
import { indexAliases } from "./yaml-document.ts";
import { evaluateCircleCiCondition } from "./rules/shared/circleci-conditions.ts";
import {
  parseCircleCiSteps,
  type CircleCiDocument,
  type CircleCiStep,
} from "./circleci-workflow.ts";
import type { JsonValue } from "./rules/shared/circleci-conditions.ts";

const MAX_EXPANSION_DEPTH = 12;
const SPECIAL_ORBS = new Set(["circleci/continuation", "circleci/path-filtering"]);

interface CommandScope {
  readonly commands: Map<string, YAMLMap<unknown, unknown>>;
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

function parameterDefaults(node: YAMLMap<unknown, unknown> | undefined): Map<string, string> {
  const defaults = new Map<string, string>();
  const parameters = node ? mapAt(node, "parameters") : undefined;
  for (const pair of parameters?.items ?? []) {
    const name = scalarValue(pair.key);
    const definition = isMap(pair.value) ? pair.value : undefined;
    const value = definition ? scalarValue(definition.get("default", true)) : undefined;
    if (name && value !== undefined) {
      defaults.set(name, value);
    }
  }
  return defaults;
}

function conditionValue(step: CircleCiStep): JsonValue | undefined {
  const condition = step.node.get("condition", true) ?? step.node.items[0]?.value;
  return (isNode(condition) ? condition.toJSON() : condition) as JsonValue | undefined;
}

function mapDefinition(
  map: YAMLMap<unknown, unknown> | undefined,
): Map<string, YAMLMap<unknown, unknown>> {
  if (!map) {
    return new Map();
  }
  const definitions = new Map<string, YAMLMap<unknown, unknown>>();
  for (const pair of map.items) {
    const key = scalarValue(pair.key);
    if (key !== undefined && isMap(pair.value)) {
      definitions.set(key, pair.value);
    }
  }
  return definitions;
}

function cloneStepAt(step: CircleCiStep, invocationNode: Node | undefined): CircleCiStep {
  if (!invocationNode) {
    return step;
  }
  return {
    ...step,
    node: isMap(invocationNode) ? invocationNode : step.node,
    invocationNode,
    nameNode: invocationNode,
    commandNode: invocationNode,
  };
}

interface ExpandOptions {
  depth: number;
  active: Set<string>;
  parameters: ReadonlyMap<string, string>;
  invocationNode?: Node;
}

function expandSteps(
  steps: CircleCiStep[],
  scope: CommandScope,
  options: ExpandOptions,
): CircleCiStep[] {
  const { depth, active, parameters, invocationNode } = options;
  if (depth > MAX_EXPANSION_DEPTH) {
    return steps;
  }
  const expanded: CircleCiStep[] = [];
  for (const step of steps) {
    const node = invocationNode ?? step.node;
    if (step.type === "when" || step.type === "unless") {
      const condition = evaluateCircleCiCondition(conditionValue(step), parameters);
      const include = step.type === "when" ? condition !== false : condition !== true;
      if (!include) {
        continue;
      }
      const nestedSteps = nodeAt(step.node, "steps");
      if (nestedSteps && isSeq(nestedSteps)) {
        const nested = expandSteps(parseCircleCiSteps(nestedSteps), scope, {
          depth: depth + 1,
          active,
          parameters,
          invocationNode: node,
        });
        expanded.push(
          ...(condition === undefined
            ? nested.map((nestedStep) => ({ ...nestedStep, conditional: true }))
            : nested),
        );
        continue;
      }
      expanded.push({ ...cloneStepAt(step, node), conditional: true });
      continue;
    }

    if (!step.type.includes("/")) {
      const command = scope.commands.get(step.type);
      const commandSteps = command ? nodeAt(command, "steps") : undefined;
      if (commandSteps && isSeq(commandSteps) && !active.has(step.type)) {
        active.add(step.type);
        const commandParameters = new Map([...parameters, ...parameterDefaults(command)]);
        expanded.push(
          ...expandSteps(parseCircleCiSteps(commandSteps), scope, {
            depth: depth + 1,
            active,
            parameters: commandParameters,
            invocationNode: node,
          }),
        );
        active.delete(step.type);
        continue;
      }
    }

    if (step.type.includes("/")) {
      const unresolved = cloneStepAt(step, invocationNode);
      unresolved.orbUnresolved = true;
      expanded.push(unresolved);
      continue;
    }
    expanded.push(cloneStepAt(step, invocationNode));
  }
  return expanded;
}

function aliasIsUsed(alias: string, source: string | undefined): boolean {
  if (source === undefined) {
    return true;
  }
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w-])${escaped}/`).test(source);
}

function unresolvedOrbReferences(document: CircleCiDocument): string[] {
  if (!document.root) {
    return [];
  }
  const orbs = mapAt(document.root, "orbs");
  if (!orbs) {
    return [];
  }
  const references: string[] = [];
  for (const pair of orbs.items) {
    const alias = scalarValue(pair.key);
    const reference = scalarValue(pair.value);
    if (!alias || !reference || !aliasIsUsed(alias, document.source)) {
      continue;
    }
    const at = reference.lastIndexOf("@");
    const fullName = at > 0 ? reference.slice(0, at) : reference;
    if (SPECIAL_ORBS.has(fullName)) {
      continue;
    }
    references.push(reference);
  }
  return [...new Set(references)].sort();
}

function resolveAliasNode(document: CircleCiDocument, node: Node | undefined): Node | undefined {
  if (!(node instanceof Alias) || !document.root) {
    return node;
  }
  return indexAliases(document.root).get(node) ?? node;
}

/** Expand a step sequence (for example pre-steps/post-steps) with invocation parameters. */
export function expandCircleCiStepNodes(
  document: CircleCiDocument,
  node: Node | undefined,
  parameters: ReadonlyMap<string, string>,
): CircleCiStep[] {
  const resolved = resolveAliasNode(document, node);
  if (!resolved || !document.root || !isSeq(resolved)) {
    return [];
  }
  // An alias pointing at a step array appears as a nested sequence; flatten it.
  const flattened = new YAMLSeq<unknown>();
  flattened.items = resolved.items.flatMap((item) => (isSeq(item) ? item.items : [item]));
  const scope: CommandScope = {
    commands: mapDefinition(mapAt(document.root, "commands")),
  };
  return expandSteps(parseCircleCiSteps(flattened), scope, {
    depth: 0,
    active: new Set(),
    parameters,
  });
}

export function expandCircleCiCommands(
  document: CircleCiDocument,
  warnings: AnalysisWarning[],
): CircleCiDocument {
  if (!document.root) {
    return document;
  }
  const scope: CommandScope = {
    commands: mapDefinition(mapAt(document.root, "commands")),
  };
  const unresolved = unresolvedOrbReferences(document);
  if (unresolved.length > 0) {
    warnings.push({
      kind: "orb-unresolved",
      source: document.relativePath,
      message: `CircleCI orb source was not fetched; ${unresolved.length} orb reference${
        unresolved.length === 1 ? "" : "s"
      } remain opaque (${unresolved.join(", ")}). Docker and Gradle findings may be incomplete.`,
    });
  }

  return {
    ...document,
    jobs: document.jobs.map((job) => ({
      ...job,
      steps: expandSteps(job.steps, scope, {
        depth: 0,
        active: new Set(),
        parameters: parameterDefaults(job.node),
      }),
    })),
  };
}
