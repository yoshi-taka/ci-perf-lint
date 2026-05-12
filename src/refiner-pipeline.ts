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
import { detectImplicationDrift } from "./rules/shared/remediation-checks.ts";

// ============================================================
// Context (shared across all phase types)
// ============================================================

export interface RefinerContext {
  mode?: AuditMode;
  warnings?: AnalysisWarning[];
  measureCompleteness?: MeasureCompletenessTracker;
  workflowPath?: string;
  inferenceGraph?: InferenceGraph;
}

// ============================================================
// Phase-separated interfaces
// ============================================================

export interface DiagnosticMap {
  readonly name: string;
  map(diagnostic: Diagnostic, ctx: RefinerContext): Diagnostic;
}

export interface DiagnosticFilter {
  readonly name: string;
  keep(diagnostic: Diagnostic, ctx: RefinerContext): boolean;
}

export interface DiagnosticListOp {
  readonly name: string;
  apply(diagnostics: Diagnostic[], ctx: RefinerContext): Diagnostic[];
}

export interface DiagnosticSorter {
  readonly name: string;
  compare(a: Diagnostic, b: Diagnostic): number;
}

// ============================================================
// Legacy Refiner (kept for backward compatibility)
// ============================================================

export interface Refiner {
  name: string;
  refine: (diagnostics: Diagnostic[], ctx: RefinerContext) => Diagnostic[];
}

// ============================================================
// Adapters: new phase types → legacy Refiner
// ============================================================

function mapToRefiner(m: DiagnosticMap): Refiner {
  return {
    name: m.name,
    refine: (diags, ctx) => diags.map((d) => m.map(d, ctx)),
  };
}

function filterToRefiner(f: DiagnosticFilter): Refiner {
  return {
    name: f.name,
    refine: (diags, ctx) => diags.filter((d) => f.keep(d, ctx)),
  };
}

function listOpToRefiner(op: DiagnosticListOp): Refiner {
  return {
    name: op.name,
    refine: (diags, ctx) => op.apply(diags, ctx),
  };
}

function sorterToRefiner(s: DiagnosticSorter): Refiner {
  return {
    name: s.name,
    refine: (diags, _ctx) => [...diags].sort((a, b) => s.compare(a, b)),
  };
}

// ============================================================
// composeRefiners (legacy, unchanged)
// ============================================================

export function composeRefiners(refiners: Refiner[]): Refiner {
  return {
    name: refiners.map((r) => r.name).join(" > "),
    refine: (diagnostics, ctx) => refiners.reduce((acc, r) => r.refine(acc, ctx), diagnostics),
  };
}

// ============================================================
// composePipeline — typed pipeline builder
//
// Phase ordering (stable, deterministic):
//   DiagnosticMap[] → DiagnosticFilter[] → DiagnosticListOp[] → DiagnosticSorter?
//
// Guarantees:
//   - Maps do not change element count or order
//   - Filters do not change element content or order
//   - ListOps may change count, content, and order (explicit escape hatch)
//   - Sorter only changes order
// ============================================================

export function composePipeline(config: {
  maps?: DiagnosticMap[];
  filters?: DiagnosticFilter[];
  listOps?: DiagnosticListOp[];
  sorter?: DiagnosticSorter;
}): Refiner {
  const phases: Refiner[] = [];

  if (config.maps && config.maps.length > 0) {
    phases.push(...config.maps.map(mapToRefiner));
  }
  if (config.filters && config.filters.length > 0) {
    phases.push(...config.filters.map(filterToRefiner));
  }
  if (config.listOps && config.listOps.length > 0) {
    phases.push(...config.listOps.map(listOpToRefiner));
  }
  if (config.sorter) {
    phases.push(sorterToRefiner(config.sorter));
  }

  return composeRefiners(phases);
}

// ============================================================
// Map phases (element-wise, 1-to-1, stable order)
// ============================================================

export function repositoryScopeFixMap(): DiagnosticMap {
  return {
    name: "repository-scope-fix",
    map: (d) =>
      d.scope === undefined && d.source?.kind === "repository"
        ? { ...d, scope: "repository" as const }
        : d,
  };
}

// ============================================================
// Filter phases (element-wise, selection only, stable order)
// ============================================================

export function modeFilter(mode: AuditMode): DiagnosticFilter {
  return {
    name: "mode-filter",
    keep: (d, ctx) => {
      const modeLocal = ctx.mode ?? mode;
      return findingIncludedInMode(d, modeLocal);
    },
  };
}

// ============================================================
// ListOp phases (full-list access — count/content/order may change)
// ============================================================

export function actionsPriorityListOp(): DiagnosticListOp {
  return {
    name: "actions-priority",
    apply: (diagnostics) => {
      const result = [...diagnostics];
      const prioritized = applyLimitedActionsPriority(result);
      result.splice(0, result.length, ...prioritized);
      return result;
    },
  };
}

function maxFindingsListOp(
  idMaxFindings: Map<string, number>,
  impliedIds: Set<string>,
): DiagnosticListOp {
  return {
    name: "max-findings-cap",
    apply: (diagnostics, ctx) => {
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

function deduplicateListOp(): DiagnosticListOp {
  return {
    name: "deduplicate-by-path-line",
    apply: (diagnostics) => {
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

// ============================================================
// Sorter phases (ordering only)
// ============================================================

export function findingSorter(): DiagnosticSorter {
  return {
    name: "sort",
    compare: compareFindings,
  };
}

// ============================================================
// Legacy Refiner factories (retained for backward compat)
// Each delegates to the new phase implementation via adapter.
// ============================================================

export function deduplicateRefiner(): Refiner {
  return listOpToRefiner(deduplicateListOp());
}

export function maxFindingsRefiner(
  idMaxFindings: Map<string, number>,
  impliedIds: Set<string>,
): Refiner {
  return listOpToRefiner(maxFindingsListOp(idMaxFindings, impliedIds));
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
