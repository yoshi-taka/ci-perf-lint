import type {
  AnalysisWarning,
  AuditMode,
  Diagnostic,
  MeasureCompletenessTracker,
} from "./types.ts";
import type { RuleId } from "./rule-engine/implication.ts";
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
// Refiner classification metadata
// ============================================================

export type RefinerKind =
  | "map" // element-wise, 1-to-1, stable count/order
  | "filter" // element-wise selection, stable order
  | "list-op" // full-list access, may change count/content/order
  | "sorter" // ordering only
  | "side-effect"; // no output change, only side effects (e.g., warnings)

// ============================================================
// Phase-separated interfaces
// ============================================================

export interface DiagnosticMap {
  readonly name: string;
  readonly kind: "map";
  readonly description?: string;
  map(diagnostic: Diagnostic, ctx: RefinerContext): Diagnostic;
}

export interface DiagnosticFilter {
  readonly name: string;
  readonly kind: "filter";
  readonly description?: string;
  keep(diagnostic: Diagnostic, ctx: RefinerContext): boolean;
}

export interface DiagnosticListOp {
  readonly name: string;
  readonly kind: "list-op";
  readonly description?: string;
  apply(diagnostics: Diagnostic[], ctx: RefinerContext): Diagnostic[];
}

export interface DiagnosticSorter {
  readonly name: string;
  readonly kind: "sorter";
  readonly description?: string;
  compare(a: Diagnostic, b: Diagnostic): number;
}

// ============================================================
// Refiner (kept for backward compatibility)
// ============================================================

export interface Refiner {
  readonly name: string;
  readonly kind: RefinerKind;
  readonly description?: string;
  refine(diagnostics: Diagnostic[], ctx: RefinerContext): Diagnostic[];
}

// ============================================================
// Adapters: new phase types → Refiner
// ============================================================

function mapToRefiner(m: DiagnosticMap): Refiner {
  return {
    name: m.name,
    kind: m.kind,
    description: m.description,
    refine: (diags, ctx) => diags.map((d) => m.map(d, ctx)),
  };
}

function filterToRefiner(f: DiagnosticFilter): Refiner {
  return {
    name: f.name,
    kind: f.kind,
    description: f.description,
    refine: (diags, ctx) => diags.filter((d) => f.keep(d, ctx)),
  };
}

function listOpToRefiner(op: DiagnosticListOp): Refiner {
  return {
    name: op.name,
    kind: op.kind,
    description: op.description,
    refine: (diags, ctx) => op.apply(diags, ctx),
  };
}

function sorterToRefiner(s: DiagnosticSorter): Refiner {
  return {
    name: s.name,
    kind: s.kind,
    description: s.description,
    refine: (diags, _ctx) => [...diags].sort((a, b) => s.compare(a, b)),
  };
}

// ============================================================
// composeRefiners (legacy, unchanged)
// ============================================================

export function composeRefiners(refiners: Refiner[]): Refiner {
  const hasSideEffect = refiners.some((r) => r.kind === "side-effect");
  const hasListOp = refiners.some((r) => r.kind === "list-op");
  const hasFilter = refiners.some((r) => r.kind === "filter");
  const hasMap = refiners.some((r) => r.kind === "map");
  const hasSorter = refiners.some((r) => r.kind === "sorter");

  const derivedKind: RefinerKind = hasSideEffect
    ? "side-effect"
    : hasSorter
      ? "sorter"
      : hasListOp
        ? "list-op"
        : hasFilter
          ? "filter"
          : hasMap
            ? "map"
            : "list-op";

  return {
    name: refiners.map((r) => r.name).join(" > "),
    kind: derivedKind,
    description: `Composed of ${refiners.length} refiner(s)`,
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
    kind: "map",
    description: "Sets scope to 'repository' for findings without scope but with repository source",
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
    kind: "filter",
    description: `Filters findings by audit mode (${mode})`,
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
    kind: "list-op",
    description: "Prioritizes top actions-scoped findings by score",
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
    kind: "list-op",
    description: "Caps findings per rule ID (order-dependent: takes first N)",
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
    kind: "list-op",
    description: "Deduplicates by path:line key (first occurrence wins)",
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
    kind: "sorter",
    description: "Sorts findings by score, severity, workflow, ruleId, location",
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
    kind: "side-effect",
    description: "Detects drift between fired and evaluated rule implications (side-effect only)",
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

// ============================================================
// Observability: Refiner effect tracking
// ============================================================

export interface RefinerEffect {
  refinerName: string;
  refinerKind: RefinerKind;
  beforeCount: number;
  afterCount: number;
  removedByRuleId?: Map<RuleId, number>;
}

export interface RefinerPipelineState {
  refiners: RefinerEffect[];
  totalBefore: number;
  totalAfter: number;
}

function countByRuleId(diagnostics: Diagnostic[]): Map<RuleId, number> {
  const counts = new Map<RuleId, number>();
  for (const d of diagnostics) {
    counts.set(d.ruleId, (counts.get(d.ruleId) ?? 0) + 1);
  }
  return counts;
}

export function runRefinersWithTracking(
  refiners: Refiner[],
  diagnostics: Diagnostic[],
  ctx: RefinerContext,
): { result: Diagnostic[]; state: RefinerPipelineState } {
  const effects: RefinerEffect[] = [];
  let current = diagnostics;
  const totalBefore = diagnostics.length;

  for (const refiner of refiners) {
    const beforeCount = current.length;
    const beforeByRule = countByRuleId(current);

    const after = refiner.refine(current, ctx);
    const afterCount = after.length;

    let removedByRuleId: Map<RuleId, number> | undefined;
    if (afterCount < beforeCount) {
      removedByRuleId = new Map();
      const afterByRule = countByRuleId(after);
      for (const [ruleId, beforeCnt] of beforeByRule) {
        const afterCnt = afterByRule.get(ruleId) ?? 0;
        if (afterCnt < beforeCnt) {
          removedByRuleId.set(ruleId, beforeCnt - afterCnt);
        }
      }
    }

    effects.push({
      refinerName: refiner.name,
      refinerKind: refiner.kind,
      beforeCount,
      afterCount,
      removedByRuleId,
    });

    current = after;
  }

  return {
    result: current,
    state: {
      refiners: effects,
      totalBefore,
      totalAfter: current.length,
    },
  };
}

export function isRefinerDumpStateEnabled(): boolean {
  return process.env.CI_PERF_LINT_DUMP_STATE === "1";
}
