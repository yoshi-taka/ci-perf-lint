import type { AuditMode, Diagnostic, Severity } from "./types.ts";

export interface SeverityPromotionRule {
  trigger: (findings: Diagnostic[]) => boolean;
  predicate: (d: Diagnostic) => boolean;
  targetSeverity: Severity;
}

export const severityPromotionRules: SeverityPromotionRule[] = [
  {
    trigger: (findings) => !findings.some((f) => f.severity === "warning"),
    predicate: (d) => d.severity === "suggestion" && strictFallbackWarningRuleIds.has(d.ruleId),
    targetSeverity: "warning",
  },
];

const strictFallbackWarningRuleIds = new Set([
  "missing-paths-filter",
  "missing-path-ignore-for-non-code",
  "missing-concurrency",
  "missing-timeout-minutes",
  "missing-dependency-cache",
  "deep-checkout-without-need",
  "deep-checkout-excessive-depth",
  "prefer-sparse-checkout-for-scoped-workflow",
]);

export function applySeverityPromotion(findings: Diagnostic[], mode: AuditMode): Diagnostic[] {
  if (mode !== "strict") {
    return findings;
  }

  for (const rule of severityPromotionRules) {
    if (!rule.trigger(findings)) {
      continue;
    }

    return findings.map((f) => (rule.predicate(f) ? { ...f, severity: rule.targetSeverity } : f));
  }

  return findings;
}
