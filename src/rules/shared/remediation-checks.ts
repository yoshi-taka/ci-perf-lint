import type { Diagnostic, ImpliedCheck, RuleMeta } from "../../types.ts";

const ruleMetaRegistry = new Map<string, RuleMeta>();

export function registerAllRuleMetaForRemediation(rules: readonly { meta: RuleMeta }[]): void {
  for (const rule of rules) {
    ruleMetaRegistry.set(rule.meta.id, rule.meta);
  }
}

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
