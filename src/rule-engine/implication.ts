import type { RuleMeta } from "../types.ts";
import { isRegisteredRuleId, type BrandedRuleId } from "./rule-id.ts";
import type { InferenceGraph } from "../rules/shared/remediation-checks.ts";

export type RuleId = string;

export type ImplicationType = "semantic-implies" | "remediation-hints" | "ordering";

export interface RuleImplication {
  readonly type: ImplicationType;
  readonly source: BrandedRuleId;
  readonly target: BrandedRuleId;
}

export interface RuleScheduling {
  readonly ordering?: readonly BrandedRuleId[][];
  readonly mutualExclusion?: readonly [BrandedRuleId, BrandedRuleId][];
}

export interface ImplicationValidation {
  missingTargets: { sourceId: string; targetId: string }[];
  cycles: string[][];
  valid: boolean;
}

function detectImplicationCycles(implications: Map<BrandedRuleId, BrandedRuleId[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<BrandedRuleId>();
  const recStack = new Set<BrandedRuleId>();
  const path: BrandedRuleId[] = [];

  function dfs(node: BrandedRuleId): void {
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

export interface ImplicationValidationEx extends ImplicationValidation {
  unregisteredRules: string[];
  unregisteredImplications: { sourceId: string; targetId: string }[];
}

export function validateImplications(
  rules: readonly { meta: RuleMeta }[],
  extraKnownIds?: Iterable<string>,
): ImplicationValidationEx {
  const allIds = new Set(rules.map((r) => r.meta.id));
  if (extraKnownIds) {
    for (const id of extraKnownIds) {
      allIds.add(id);
    }
  }

  const missingTargets: { sourceId: string; targetId: string }[] = [];
  const graph = new Map<string, string[]>();
  const unregisteredRules: string[] = [];
  const unregisteredImplications: { sourceId: string; targetId: string }[] = [];

  for (const rule of rules) {
    const sourceId = rule.meta.id;

    if (!isRegisteredRuleId(sourceId) && !unregisteredRules.includes(sourceId)) {
      unregisteredRules.push(sourceId);
    }

    const edges: string[] = [];

    const legacy = rule.meta.impliedChecks ?? [];
    for (const target of legacy) {
      if (!allIds.has(target)) {
        missingTargets.push({ sourceId, targetId: target });
      }
      if (!isRegisteredRuleId(target)) {
        unregisteredImplications.push({ sourceId, targetId: target });
      }
      edges.push(target);
    }

    const typed = rule.meta.implications ?? [];
    for (const impl of typed) {
      if (impl.type !== "ordering") {
        if (!allIds.has(impl.target)) {
          missingTargets.push({ sourceId, targetId: impl.target });
        }
        if (!isRegisteredRuleId(impl.target)) {
          unregisteredImplications.push({ sourceId, targetId: impl.target });
        }
        edges.push(impl.target);
      }
    }

    if (edges.length > 0) {
      graph.set(sourceId, edges);
    }
  }

  const cycles = detectImplicationCycles(graph as Map<BrandedRuleId, BrandedRuleId[]>);

  return {
    missingTargets,
    cycles,
    valid: missingTargets.length === 0 && cycles.length === 0,
    unregisteredRules,
    unregisteredImplications,
  };
}

export interface SchedulingResult {
  orderedRanks: BrandedRuleId[][];
  skipped: { ruleId: BrandedRuleId; reason: string }[];
}

export function computeScheduling(
  rules: readonly { meta: RuleMeta }[],
  firedRules: Set<string>,
): SchedulingResult {
  const orderingConstraints: [string, string][] = [];

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

  const rankMap = new Map<string, number>();
  const rulesByRank = new Map<number, string[]>();

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
  const orderedRanks: BrandedRuleId[][] = [];
  for (let i = 0; i <= maxRank; i++) {
    orderedRanks.push((rulesByRank.get(i) ?? []) as BrandedRuleId[]);
  }

  return { orderedRanks, skipped: [] };
}

export interface ImplicationObservability {
  activeImplications: { source: BrandedRuleId; target: BrandedRuleId; type: ImplicationType }[];
  skippedRules: { ruleId: BrandedRuleId; reason: string }[];
  evaluationOrder: BrandedRuleId[];
}

export function buildImplicationObservability(
  graph: InferenceGraph,
  scheduling: SchedulingResult,
): ImplicationObservability {
  const activeImplications: {
    source: BrandedRuleId;
    target: BrandedRuleId;
    type: ImplicationType;
  }[] = [];

  for (const [source, targets] of graph.forwards) {
    for (const target of targets) {
      activeImplications.push({
        source: source as BrandedRuleId,
        target: target as BrandedRuleId,
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
