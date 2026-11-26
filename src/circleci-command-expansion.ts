import type { AnalysisWarning } from "./types.ts";
import { isMap, isNode, isScalar, isSeq, type Node, type YAMLMap } from "./yaml.ts";
import {
  parseCircleCiSteps,
  type CircleCiDocument,
  type CircleCiStep,
} from "./circleci-workflow.ts";

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

function expandSteps(
  steps: CircleCiStep[],
  scope: CommandScope,
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

    if (!step.type.includes("/")) {
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
      steps: expandSteps(job.steps, scope, 0, new Set()),
    })),
  };
}
