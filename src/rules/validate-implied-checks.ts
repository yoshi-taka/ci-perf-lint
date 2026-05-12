import type { RuleMeta } from "../types.ts";

export interface ImpliedChecksValidation {
  missingTargets: { sourceId: string; targetId: string }[];
  valid: boolean;
}

function detectCycles(rules: readonly { meta: RuleMeta }[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const rule of rules) {
    const implied = rule.meta.impliedChecks;
    if (implied && implied.length > 0) {
      graph.set(rule.meta.id, [...implied]);
    }
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!graph.has(neighbor)) {
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

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

export function validateImpliedChecks(
  rules: readonly { meta: RuleMeta }[],
  extraKnownIds?: Iterable<string>,
): ImpliedChecksValidation {
  const allIds = new Set(rules.map((r) => r.meta.id));
  if (extraKnownIds) {
    for (const id of extraKnownIds) {
      allIds.add(id);
    }
  }
  const missingTargets: { sourceId: string; targetId: string }[] = [];

  for (const rule of rules) {
    for (const implied of rule.meta.impliedChecks ?? []) {
      if (!allIds.has(implied)) {
        missingTargets.push({ sourceId: rule.meta.id, targetId: implied });
      }
    }
  }

  const cycles = detectCycles(rules);

  return {
    missingTargets,
    valid: missingTargets.length === 0 && cycles.length === 0,
  };
}
