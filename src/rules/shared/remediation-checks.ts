import type { AnalysisWarning, Diagnostic, ImpliedCheck, RuleMeta } from "../../types.ts";
import { transitiveClosure } from "./predicate-lattice.ts";

const ruleMetaRegistry = new Map<string, RuleMeta>();

export function registerAllRuleMetaForRemediation(rules: readonly { meta: RuleMeta }[]): void {
  for (const rule of rules) {
    ruleMetaRegistry.set(rule.meta.id, rule.meta);
  }
}

// ──────────────────────────────────────────────
// INFERENCE GRAPH — first-class implication structure
// ──────────────────────────────────────────────

export interface InferenceGraph {
  forwards: ReadonlyMap<string, readonly string[]>;
  reverse: ReadonlyMap<string, readonly string[]>;
  transitiveForwards: ReadonlyMap<string, ReadonlySet<string>>;
}

export function buildInferenceGraph(rules: readonly { meta: RuleMeta }[]): InferenceGraph {
  const forwards = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();

  for (const rule of rules) {
    const implied = rule.meta.impliedChecks;
    if (implied && implied.length > 0) {
      forwards.set(rule.meta.id, [...implied]);
    }
  }

  for (const rule of rules) {
    for (const implied of rule.meta.impliedChecks ?? []) {
      const sources = reverse.get(implied) ?? [];
      sources.push(rule.meta.id);
      reverse.set(implied, sources);
    }
  }

  const closure = transitiveClosure(forwards);

  return { forwards, reverse, transitiveForwards: closure };
}

// ──────────────────────────────────────────────
// IMPLICATION-AWARE CONSISTENCY
// ──────────────────────────────────────────────

function detectDriftForEdges(
  sourceId: string,
  impliedIds: Iterable<string>,
  firedRuleIds: Set<string>,
  evaluatedRuleIds: Set<string>,
  warnings: AnalysisWarning[],
): void {
  for (const impliedId of impliedIds) {
    if (firedRuleIds.has(impliedId)) {
      continue;
    }

    if (evaluatedRuleIds.has(impliedId)) {
      warnings.push({
        kind: "remediation-drift",
        source: "rule-engine",
        message: `Rule ${sourceId} fired but implied rule ${impliedId} produced no findings — possible semantic drift or rule configuration mismatch.`,
      });
    } else {
      warnings.push({
        kind: "remediation-drift",
        source: "rule-engine",
        message: `Rule ${sourceId} fired but implied rule ${impliedId} was not evaluated — the implication may be stale or the target rule may be gated by unmet required features.`,
      });
    }
  }
}

export function detectImplicationDrift(
  firedRuleIds: Set<string>,
  evaluatedRuleIds: Set<string>,
  graph: InferenceGraph,
): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];

  for (const [sourceId, impliedIds] of graph.forwards) {
    if (!firedRuleIds.has(sourceId)) {
      continue;
    }
    detectDriftForEdges(sourceId, impliedIds, firedRuleIds, evaluatedRuleIds, warnings);
  }

  for (const [sourceId, transitiveIds] of graph.transitiveForwards) {
    if (!firedRuleIds.has(sourceId)) {
      continue;
    }
    const direct = new Set(graph.forwards.get(sourceId) ?? []);
    const indirect = new Set([...transitiveIds].filter((id) => !direct.has(id)));
    if (indirect.size > 0) {
      detectDriftForEdges(sourceId, indirect, firedRuleIds, evaluatedRuleIds, warnings);
    }
  }

  return warnings;
}

// ──────────────────────────────────────────────
// EXISTING: computeImpliedChecks (remediation layer)
// ──────────────────────────────────────────────

function collectImpliedIds(ruleId: string): Set<string> {
  const collected = new Set<string>();
  const meta = ruleMetaRegistry.get(ruleId);
  if (meta?.impliedChecks) {
    for (const id of meta.impliedChecks) {
      collected.add(id);
    }
  }
  return collected;
}

function transitiveImpliedIds(ruleId: string): Set<string> {
  const visited = new Set<string>();
  const stack = [ruleId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const meta = ruleMetaRegistry.get(current);
    if (meta?.impliedChecks) {
      for (const id of meta.impliedChecks) {
        if (!visited.has(id)) {
          visited.add(id);
          stack.push(id);
        }
      }
    }
  }
  return visited;
}

export function computeImpliedChecks(findings: Diagnostic[]): ImpliedCheck[] {
  const seenRuleIds = new Set(findings.map((f) => f.ruleId));
  const result: ImpliedCheck[] = [];
  const dedup = new Set<string>();

  for (const finding of findings) {
    const directIds = collectImpliedIds(finding.ruleId);
    const allIds = transitiveImpliedIds(finding.ruleId);

    for (const implied of allIds) {
      const isDirect = directIds.has(implied);
      const key = `${finding.ruleId}->${implied}`;
      if (dedup.has(key)) {
        continue;
      }
      dedup.add(key);

      const impliedMeta = ruleMetaRegistry.get(implied);
      const alreadyPresent = seenRuleIds.has(implied);
      let reason: string;
      if (isDirect) {
        if (alreadyPresent) {
          reason = `${finding.ruleId} fix may also be needed by existing ${implied} finding`;
        } else {
          reason = `After fixing ${finding.ruleId}, validate ${implied} to ensure remediation stability`;
        }
      } else {
        if (alreadyPresent) {
          reason = `${finding.ruleId} fix may transitively affect ${implied} (directly implied by ${[...directIds].filter((d) => transitiveImpliedIds(d).has(implied)).join(", ") || "intermediate"})`;
        } else {
          reason = `After fixing ${finding.ruleId}, consider checking ${implied} via transitive implication chain`;
        }
      }
      if (impliedMeta?.docsPath) {
        reason += ` (${impliedMeta.docsPath})`;
      }

      result.push({
        sourceRuleId: finding.ruleId,
        impliedRuleId: implied,
        reason,
      });
    }
  }

  return result;
}
