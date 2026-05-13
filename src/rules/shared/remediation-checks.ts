import type { AnalysisWarning, Diagnostic, ImpliedCheck, RuleMeta } from "../../types.ts";
import { buildReverseGraph, transitiveClosure } from "./predicate-lattice.ts";

const ruleMetaRegistry = new Map<string, RuleMeta>();

export function registerAllRuleMetaForRemediation(rules: readonly { meta: RuleMeta }[]): void {
  for (const rule of rules) {
    ruleMetaRegistry.set(rule.meta.id, rule.meta);
  }
}

function buildForwardGraph(rules: readonly { meta: RuleMeta }[]): Map<string, string[]> {
  const forwards = new Map<string, string[]>();
  for (const rule of rules) {
    const edges: string[] = [];

    const legacy = rule.meta.impliedChecks ?? [];
    edges.push(...legacy);

    const typed = rule.meta.implications ?? [];
    for (const impl of typed) {
      if (impl.type !== "ordering") {
        edges.push(impl.target);
      }
    }

    if (edges.length > 0) {
      forwards.set(rule.meta.id, edges);
    }
  }
  return forwards;
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
  const forwards = buildForwardGraph(rules);
  const reverse = buildReverseGraph(forwards);
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
    const indirect = [...transitiveIds].filter((id) => !direct.has(id)).sort();
    if (indirect.length > 0) {
      detectDriftForEdges(sourceId, indirect, firedRuleIds, evaluatedRuleIds, warnings);
    }
  }

  return warnings;
}

// ──────────────────────────────────────────────
// REMEDIATION CHECKS — multi-hop aware
// ──────────────────────────────────────────────

function buildFullClosure(): Map<string, Set<string>> {
  const forwards = new Map<string, string[]>();
  for (const [ruleId, meta] of ruleMetaRegistry) {
    if (meta.impliedChecks && meta.impliedChecks.length > 0) {
      forwards.set(ruleId, [...meta.impliedChecks]);
    }
  }
  return transitiveClosure(forwards);
}

function buildDirectMap(): Map<string, Set<string>> {
  const direct = new Map<string, Set<string>>();
  for (const [ruleId, meta] of ruleMetaRegistry) {
    if (meta.impliedChecks) {
      direct.set(ruleId, new Set(meta.impliedChecks));
    }
  }
  return direct;
}

export function computeImpliedChecks(findings: Diagnostic[]): ImpliedCheck[] {
  const closure = buildFullClosure();
  const directMap = buildDirectMap();
  const seenRuleIds = new Set(findings.map((f) => f.ruleId));
  const result: ImpliedCheck[] = [];
  const dedup = new Set<string>();

  const reverseClosure = buildReverseGraph(closure);

  for (const finding of findings) {
    const allIds = closure.get(finding.ruleId);
    if (!allIds || allIds.size === 0) {
      continue;
    }
    const directIds = directMap.get(finding.ruleId) ?? new Set();

    const sorted = [...allIds].sort();
    for (const implied of sorted) {
      const key = `${finding.ruleId}->${implied}`;
      if (dedup.has(key)) {
        continue;
      }
      dedup.add(key);

      const impliedMeta = ruleMetaRegistry.get(implied);
      const alreadyPresent = seenRuleIds.has(implied);

      let reason: string;
      if (directIds.has(implied)) {
        if (alreadyPresent) {
          reason = `${finding.ruleId} fix may also be needed by existing ${implied} finding`;
        } else {
          reason = `After fixing ${finding.ruleId}, validate ${implied} to ensure remediation stability`;
        }
      } else {
        const paths = (reverseClosure.get(implied) ?? []).filter(
          (p) => p !== finding.ruleId && directIds.has(p),
        );
        const via = [...new Set(paths)].sort().join(", ") || "intermediate rule";
        if (alreadyPresent) {
          reason = `${finding.ruleId} fix may transitively affect ${implied} (via ${via})`;
        } else {
          reason = `After fixing ${finding.ruleId}, consider checking ${implied} via ${via}`;
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
