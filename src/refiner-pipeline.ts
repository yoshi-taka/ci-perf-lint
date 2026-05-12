import type {
  AnalysisWarning,
  AuditMode,
  Diagnostic,
  MeasureCompletenessTracker,
} from "./types.ts";
import type { InferenceGraph } from "./rules/shared/remediation-checks.ts";
import {
  applyLimitedActionsPriority,
  compareFindings,
  findingIncludedInMode,
} from "./repo-finding-utils.ts";
import { applySeverityPromotion } from "./severity-promotion.ts";
import { detectImplicationDrift } from "./rules/shared/remediation-checks.ts";

export interface RefinerContext {
  mode?: AuditMode;
  warnings?: AnalysisWarning[];
  measureCompleteness?: MeasureCompletenessTracker;
  workflowPath?: string;
  inferenceGraph?: InferenceGraph;
}

export interface Refiner {
  name: string;
  refine: (diagnostics: Diagnostic[], ctx: RefinerContext) => Diagnostic[];
}

export function composeRefiners(refiners: Refiner[]): Refiner {
  return {
    name: refiners.map((r) => r.name).join(" > "),
    refine: (diagnostics, ctx) => refiners.reduce((acc, r) => r.refine(acc, ctx), diagnostics),
  };
}

export function deduplicateRefiner(): Refiner {
  return {
    name: "deduplicate-by-path-line",
    refine: (diagnostics) => {
      const seen = new Map<string, Diagnostic>();
      for (const d of diagnostics) {
        const key = `${d.location.path}:${d.location.line}`;
        if (!seen.has(key)) {
          seen.set(key, d);
        }
      }
      return [...seen.values()];
    },
  };
}

export function maxFindingsRefiner(
  idMaxFindings: Map<string, number>,
  impliedIds: Set<string>,
): Refiner {
  return {
    name: "max-findings-cap",
    refine: (diagnostics, ctx) => {
      if (idMaxFindings.size === 0) {
        return diagnostics;
      }

      const caps = new Map<string, number>();
      const cappedCounts = new Map<string, number>();

      const filtered = diagnostics.filter((d) => {
        const max = idMaxFindings.get(d.ruleId);
        if (max === undefined || impliedIds.has(d.ruleId)) {
          return true;
        }
        const count = caps.get(d.ruleId) ?? 0;
        if (count >= max) {
          cappedCounts.set(d.ruleId, (cappedCounts.get(d.ruleId) ?? 0) + 1);
          return false;
        }
        caps.set(d.ruleId, count + 1);
        return true;
      });

      for (const [ruleId, suppressed] of cappedCounts) {
        const max = idMaxFindings.get(ruleId);
        if (ctx.warnings && max !== undefined) {
          const workflowPath = ctx.workflowPath ?? "unknown";
          ctx.warnings.push({
            kind: "max-findings-hit",
            source: workflowPath,
            message: `Rule ${ruleId} produced more than ${max} findings and ${suppressed} were suppressed by maxFindings.`,
          });
        }
      }

      return filtered;
    },
  };
}

export function severityPromotionRefiner(mode: AuditMode): Refiner {
  return {
    name: "severity-promotion",
    refine: (diagnostics) => applySeverityPromotion(diagnostics, mode),
  };
}

export function repositoryScopeFixRefiner(): Refiner {
  return {
    name: "repository-scope-fix",
    refine: (diagnostics) =>
      diagnostics.map((finding) =>
        finding.scope === undefined && finding.source?.kind === "repository"
          ? { ...finding, scope: "repository" as const }
          : finding,
      ),
  };
}

export function modeFilterRefiner(mode: AuditMode): Refiner {
  return {
    name: "mode-filter",
    refine: (diagnostics) => diagnostics.filter((d) => findingIncludedInMode(d, mode)),
  };
}

export function actionsPriorityRefiner(): Refiner {
  return {
    name: "actions-priority",
    refine: (diagnostics) => {
      const result = [...diagnostics];
      const prioritized = applyLimitedActionsPriority(result);
      result.splice(0, result.length, ...prioritized);
      return result;
    },
  };
}

export function sortRefiner(): Refiner {
  return {
    name: "sort",
    refine: (diagnostics) => [...diagnostics].sort(compareFindings),
  };
}

export function driftDetectionRefiner(
  firedRuleIds: Set<string>,
  evaluatedRuleIds: Set<string>,
  inferenceGraph: InferenceGraph,
): Refiner {
  return {
    name: "drift-detection",
    refine: (diagnostics, ctx) => {
      if (!ctx.warnings) {
        return diagnostics;
      }
      const drift = detectImplicationDrift(firedRuleIds, evaluatedRuleIds, inferenceGraph);
      ctx.warnings.push(...drift);
      return diagnostics;
    },
  };
}
