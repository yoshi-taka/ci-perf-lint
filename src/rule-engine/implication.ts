import type { RuleMeta } from "../types.ts";

export type RuleId = string;
import type { InferenceGraph } from "../rules/shared/remediation-checks.ts";

export type ImplicationType = "semantic-implies" | "remediation-hints" | "ordering";

export interface RuleImplication {
  readonly type: ImplicationType;
  readonly source: RuleId;
  readonly target: RuleId;
}

export interface RuleScheduling {
  readonly ordering?: readonly RuleId[][];
  readonly mutualExclusion?: readonly [RuleId, RuleId][];
}

export interface ImplicationValidation {
  missingTargets: { sourceId: string; targetId: string }[];
  cycles: string[][];
  valid: boolean;
}

function detectImplicationCycles(implications: Map<RuleId, RuleId[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<RuleId>();
  const recStack = new Set<RuleId>();
  const path: RuleId[] = [];

  function dfs(node: RuleId): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of implications.get(node) ?? []) {
      if (!implications.has(neighbor)) {
        continue;
      }
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), neighbor]);
        }
      }
    }

    path.pop();
    recStack.delete(node);
  }

  for (const node of implications.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

export function validateImplications(
  rules: readonly { meta: RuleMeta }[],
  extraKnownIds?: Iterable<string>,
): ImplicationValidation {
  const allIds = new Set(rules.map((r) => r.meta.id));
  if (extraKnownIds) {
    for (const id of extraKnownIds) {
      allIds.add(id);
    }
  }

  const missingTargets: { sourceId: string; targetId: string }[] = [];
  const graph = new Map<RuleId, RuleId[]>();

  for (const rule of rules) {
    const sourceId = rule.meta.id;
    const edges: RuleId[] = [];

    const legacy = rule.meta.impliedChecks ?? [];
    for (const target of legacy) {
      if (!allIds.has(target)) {
        missingTargets.push({ sourceId, targetId: target });
      }
      edges.push(target);
    }

    const typed = rule.meta.implications ?? [];
    for (const impl of typed) {
      if (impl.type !== "ordering") {
        if (!allIds.has(impl.target)) {
          missingTargets.push({ sourceId, targetId: impl.target });
        }
        edges.push(impl.target);
      }
    }

    if (edges.length > 0) {
      graph.set(sourceId, edges);
    }
  }

  const cycles = detectImplicationCycles(graph);

  return {
    missingTargets,
    cycles,
    valid: missingTargets.length === 0 && cycles.length === 0,
  };
}

export interface SchedulingResult {
  orderedRanks: RuleId[][];
  skipped: { ruleId: RuleId; reason: string }[];
}

export function computeScheduling(
  rules: readonly { meta: RuleMeta }[],
  firedRules: Set<RuleId>,
): SchedulingResult {
  const orderingConstraints: [RuleId, RuleId][] = [];

  for (const rule of rules) {
    const sched = rule.meta.scheduling;
    if (!sched) {
      continue;
    }

    for (const [a, b] of sched.mutualExclusion ?? []) {
      if (firedRules.has(a)) {
        return {
          orderedRanks: [],
          skipped: [{ ruleId: b, reason: `mutual-exclusion: ${a} fired` }],
        };
      }
      if (firedRules.has(b)) {
        return {
          orderedRanks: [],
          skipped: [{ ruleId: a, reason: `mutual-exclusion: ${b} fired` }],
        };
      }
    }

    for (const group of sched.ordering ?? []) {
      for (let i = 0; i < group.length - 1; i++) {
        const a = group[i];
        const b = group[i + 1];
        if (a && b) {
          orderingConstraints.push([a, b]);
        }
      }
    }
  }

  const rankMap = new Map<RuleId, number>();
  const rulesByRank = new Map<number, RuleId[]>();

  for (const [before, after] of orderingConstraints) {
    const currentRank = rankMap.get(before) ?? 0;
    rankMap.set(before, currentRank);
    const afterRank = rankMap.get(after) ?? 0;
    const newRank = Math.max(afterRank, currentRank + 1);
    rankMap.set(after, newRank);
  }

  for (const [ruleId, rank] of rankMap) {
    const list = rulesByRank.get(rank) ?? [];
    list.push(ruleId);
    rulesByRank.set(rank, list);
  }

  const maxRank = Math.max(...rankMap.values(), 0);
  const orderedRanks: RuleId[][] = [];
  for (let i = 0; i <= maxRank; i++) {
    orderedRanks.push(rulesByRank.get(i) ?? []);
  }

  return { orderedRanks, skipped: [] };
}

export interface ImplicationObservability {
  activeImplications: { source: RuleId; target: RuleId; type: ImplicationType }[];
  skippedRules: { ruleId: RuleId; reason: string }[];
  evaluationOrder: RuleId[];
}

export function buildImplicationObservability(
  graph: InferenceGraph,
  scheduling: SchedulingResult,
): ImplicationObservability {
  const activeImplications: { source: RuleId; target: RuleId; type: ImplicationType }[] = [];

  for (const [source, targets] of graph.forwards) {
    for (const target of targets) {
      activeImplications.push({
        source,
        target,
        type: "semantic-implies",
      });
    }
  }

  const flatOrder = scheduling.orderedRanks.flat();

  return {
    activeImplications,
    skippedRules: scheduling.skipped,
    evaluationOrder: flatOrder,
  };
}
