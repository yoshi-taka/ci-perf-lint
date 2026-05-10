import type { AnalysisWarning, Diagnostic, ImpliedCheck, RuleMeta } from "../../types.ts";

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

  return { forwards, reverse };
}

// ──────────────────────────────────────────────
// IMPLICATION-AWARE CONSISTENCY
// ──────────────────────────────────────────────

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

  return warnings;
}

// ──────────────────────────────────────────────
// EXISTING: computeImpliedChecks (remediation layer)
// ──────────────────────────────────────────────

export function computeImpliedChecks(findings: Diagnostic[]): ImpliedCheck[] {
  const seenRuleIds = new Set(findings.map((f) => f.ruleId));
  const result: ImpliedCheck[] = [];
  const dedup = new Set<string>();

  for (const finding of findings) {
    const meta = ruleMetaRegistry.get(finding.ruleId);
    if (!meta?.impliedChecks) {
      continue;
    }

    for (const implied of meta.impliedChecks) {
      const key = `${finding.ruleId}->${implied}`;
      if (dedup.has(key)) {
        continue;
      }
      dedup.add(key);

      const impliedMeta = ruleMetaRegistry.get(implied);
      const alreadyPresent = seenRuleIds.has(implied);
      let reason: string;
      if (alreadyPresent) {
        reason = `${finding.ruleId} fix may also be needed by existing ${implied} finding`;
      } else {
        reason = `After fixing ${finding.ruleId}, validate ${implied} to ensure remediation stability`;
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
