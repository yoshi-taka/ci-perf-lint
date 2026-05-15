/* oxlint-disable typescript/prefer-for-of */
import type { AnalysisWarning, Diagnostic, MeasureCompletenessTracker } from "../types.ts";
import type { RuleContext, AnyRuleModule, ScoredWorkflow } from "./types.ts";
import type { AnyWorkflowDocument } from "../ci-types.ts";
import { prewarmStepAnalysisCaches } from "../rules/shared/step-analysis-prewarm.ts";
import {
  composeRefiners,
  deduplicateRefiner,
  driftDetectionRefiner,
  maxFindingsRefiner,
  runRefinersWithTracking,
  isRefinerDumpStateEnabled,
} from "../refiner-pipeline.ts";
import { classifySingularity } from "../rules/shared/singularity.ts";
import { buildInferenceGraph } from "../rules/shared/remediation-checks.ts";
import { getRulesForKind, pushAnalysisWarning, runConcurrent } from "./utils.ts";
import { workflowContainsKind, shouldSkipForWorkflow, shouldEvaluateRule } from "./filters.ts";
import { getWorkflowFacts } from "../rules/shared/workflow-analysis.ts";

async function runRuleSafely(
  ruleId: string,
  workflowPath: string,
  context: RuleContext,
  warnings: AnalysisWarning[] | undefined,
  run: () => Diagnostic[] | Promise<Diagnostic[]>,
): Promise<{ diagnostics: Diagnostic[]; errored: boolean }> {
  try {
    const diagnostics = await run();
    return { diagnostics, errored: false };
  } catch (error) {
    const failure = classifySingularity(error, ruleId, workflowPath);
    context.singularities?.record(failure);
    if (warnings) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push({
        kind: "rule-error",
        source: workflowPath,
        message: `[${failure.class}] Rule ${ruleId} failed: ${detail}`,
      });
    }
    return { diagnostics: [], errored: true };
  }
}

function applyMaxFindings(
  diagnostics: Diagnostic[],
  maxFindings: number | undefined,
  ruleId: string,
  opts: {
    source: string;
    warnings: AnalysisWarning[] | undefined;
    measureCompleteness?: MeasureCompletenessTracker;
  },
): Diagnostic[] {
  if (maxFindings !== undefined && diagnostics.length > maxFindings) {
    opts.measureCompleteness?.maxFindingsHitRules.add(ruleId);
    pushAnalysisWarning(opts.warnings, {
      kind: "max-findings-hit",
      source: opts.source,
      message: `Rule ${ruleId} produced ${diagnostics.length} findings and was capped at ${maxFindings}.`,
    });
    return diagnostics.slice(0, maxFindings);
  }
  return diagnostics;
}

const scopeGateDebugEnabled = process.env.CI_PERF_LINT_DUMP_STATE === "1";

export async function evaluateRules(
  workflow: AnyWorkflowDocument,
  context: RuleContext,
  warnings?: AnalysisWarning[],
  findingCounts?: Map<string, number>,
  ruleFilter?: (rule: AnyRuleModule) => boolean,
): Promise<Diagnostic[]> {
  prewarmStepAnalysisCaches(workflow);

  const docKind = workflow.kind;
  const rules = await getRulesForKind(docKind);

  if (scopeGateDebugEnabled) {
    process.stderr.write(
      `${JSON.stringify({
        type: "scope-gate-state",
        workflowPath: workflow.relativePath,
        kind: docKind,
      })}\n`,
    );
  }

  const allRules = rules as unknown as readonly AnyRuleModule[];

  interface RuleTask {
    rule: AnyRuleModule;
    run: () => Promise<Diagnostic[]>;
  }

  const inferenceGraph = buildInferenceGraph(allRules);
  const tasks: RuleTask[] = [];
  const evaluatedRuleIds = new Set<string>();
  const workflowPath = workflow.relativePath;
  const wfFacts = getWorkflowFacts(workflow);
  const wfFactsState = wfFacts as unknown as Record<string, unknown>;

  for (const rule of allRules) {
    if (!shouldEvaluateRule(rule, context, workflowPath, warnings, ruleFilter)) {
      continue;
    }

    const rmeta = rule.meta;
    const featurePred =
      rmeta.featurePredicate ??
      (rule as AnyRuleModule & { featurePredicate?: (state: Record<string, unknown>) => boolean })
        .featurePredicate;
    if (featurePred && !featurePred(wfFactsState)) {
      context.measureCompleteness?.skippedGates.add(rmeta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: workflowPath,
        message: `Rule ${rmeta.id} was not evaluated because the workflow feature mask did not match.`,
      });
      continue;
    }

    if (rule.nodeTypes && !rule.nodeTypes.some((kind) => workflowContainsKind(workflow, kind))) {
      context.measureCompleteness?.skippedGates.add(rmeta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: workflowPath,
        message: `Rule ${rmeta.id} was not evaluated because the workflow node types did not match its scope.`,
      });
      continue;
    }

    const skipPred = rmeta.skipIf;
    if (skipPred && shouldSkipForWorkflow(skipPred, workflow, context.allWorkflows)) {
      context.measureCompleteness?.skippedGates.add(rmeta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: workflowPath,
        message: `Rule ${rmeta.id} was not evaluated because its skipIf predicate matched.`,
      });
      continue;
    }

    const checkFn = rule.check;
    evaluatedRuleIds.add(rmeta.id);
    tasks.push({ rule, run: () => Promise.resolve(checkFn(workflow as never, context)) });
  }

  if (tasks.length > 0) {
    context.measureCompleteness?.evaluatedWorkflowPaths.add(workflowPath);
  }

  const settled = await runConcurrent(
    tasks,
    async (task) => {
      const { diagnostics, errored } = await runRuleSafely(
        task.rule.meta.id,
        workflowPath,
        context,
        warnings,
        () => task.run(),
      );
      return { diagnostics, rule: task.rule, errored };
    },
    4,
  );

  const ruleResults: Diagnostic[] = [];
  const idMaxFindings = new Map<string, number>();
  const firedRuleIds = new Set<string>();

  for (let i = 0; i < settled.length; i++) {
    const { diagnostics, rule, errored } = settled[i]!;
    const { maxFindings } = rule.meta;
    if (maxFindings !== undefined) {
      idMaxFindings.set(rule.meta.id, maxFindings);
    }
    if (diagnostics.length > 0) {
      firedRuleIds.add(rule.meta.id);
    } else if (!errored) {
      pushAnalysisWarning(warnings, {
        kind: "empty-result",
        source: `${workflowPath}#${rule.meta.id}`,
        message: `Rule ${rule.meta.id} ran and found nothing for ${workflowPath}.`,
      });
    }
    for (let j = 0; j < diagnostics.length; j++) {
      ruleResults.push(diagnostics[j]!);
    }
  }

  driftDetectionRefiner(firedRuleIds, evaluatedRuleIds, inferenceGraph).refine(ruleResults, {
    warnings,
  });

  if (!findingCounts && idMaxFindings.size === 0) {
    return deduplicateRefiner().refine(ruleResults, {});
  }

  const impliedIds = new Set<string>();
  for (const [, impliedList] of inferenceGraph.forwards) {
    for (const id of impliedList) {
      impliedIds.add(id);
    }
  }
  for (const [, transitiveIds] of inferenceGraph.transitiveForwards) {
    for (const id of transitiveIds) {
      impliedIds.add(id);
    }
  }

  const refiners = [maxFindingsRefiner(idMaxFindings, impliedIds)];
  let filtered: Diagnostic[];

  if (isRefinerDumpStateEnabled()) {
    const ctx = {
      warnings,
      measureCompleteness: context.measureCompleteness,
      workflowPath,
    };
    const { result, state } = runRefinersWithTracking(refiners, ruleResults, ctx);
    filtered = result;
    if (warnings) {
      for (const effect of state.refiners) {
        if (effect.removedByRuleId && effect.removedByRuleId.size > 0) {
          warnings.push({
            kind: "refiner-effect",
            source: workflowPath,
            message: `[${effect.refinerName}] removed ${effect.beforeCount - effect.afterCount} diagnostics (${effect.refinerKind})`,
          });
        }
      }
    }
  } else {
    filtered = composeRefiners(refiners).refine(ruleResults, {
      warnings,
      measureCompleteness: context.measureCompleteness,
      workflowPath,
    });
  }

  if (findingCounts) {
    for (let i = 0; i < filtered.length; i++) {
      const d = filtered[i]!;
      findingCounts.set(d.ruleId, (findingCounts.get(d.ruleId) ?? 0) + 1);
    }
  }

  return filtered;
}

export async function evaluateRulesCoarseToFine(
  workflows: AnyWorkflowDocument[],
  context: RuleContext,
  warnings?: AnalysisWarning[],
  findingCounts?: Map<string, number>,
  ruleFilter?: (rule: AnyRuleModule) => boolean,
): Promise<Diagnostic[]> {
  if (workflows.length === 0) {
    return [];
  }

  const docKind = workflows[0]!.kind;
  const rules = await getRulesForKind(docKind);
  const allRules = rules as unknown as readonly AnyRuleModule[];

  const inferenceGraph = buildInferenceGraph(allRules);
  const evaluatedRuleIds = new Set<string>();
  const firedRuleIds = new Set<string>();

  const workflowResults = new Array<Diagnostic[]>(workflows.length);
  for (let i = 0; i < workflowResults.length; i++) {
    workflowResults[i] = [];
  }
  const workflowIndexByRef = new Map<AnyWorkflowDocument, number>();
  for (let i = 0; i < workflows.length; i++) {
    workflowIndexByRef.set(workflows[i]!, i);
  }

  const prewarmCache = new Map<string, Record<string, unknown>>();
  function getWfFactsState(wf: AnyWorkflowDocument): Record<string, unknown> {
    const path = wf.relativePath;
    let state = prewarmCache.get(path);
    if (!state) {
      prewarmStepAnalysisCaches(wf);
      state = getWorkflowFacts(wf) as unknown as Record<string, unknown>;
      prewarmCache.set(path, state);
    }
    return state;
  }

  for (const rule of allRules) {
    if (!shouldEvaluateRule(rule, context, rule.meta.id, warnings, ruleFilter)) {
      continue;
    }

    const ruleId = rule.meta.id;
    evaluatedRuleIds.add(ruleId);

    const { maxFindings, precheckBudget = 20 } = rule.meta;
    const precheck = rule.meta.precheck;

    let candidates: ScoredWorkflow[];
    if (precheck) {
      candidates = selectTopK(workflows, precheck, precheckBudget);
    } else {
      candidates = new Array<ScoredWorkflow>(workflows.length);
      for (let i = 0; i < workflows.length; i++) {
        candidates[i] = { workflow: workflows[i]!, score: 1 };
      }
    }

    if (candidates.length === 0) {
      context.measureCompleteness?.skippedGates.add(ruleId);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: ruleId,
        message: `Rule ${ruleId} was not evaluated because its precheck selected no workflows.`,
      });
      continue;
    }

    for (let ci = 0; ci < candidates.length; ci++) {
      const { workflow } = candidates[ci]!;
      const workflowPath = workflow.relativePath;
      context.measureCompleteness?.evaluatedWorkflowPaths.add(workflowPath);

      if (context.singularities?.hasPoleTrigger(ruleId, workflowPath)) {
        context.measureCompleteness?.skippedGates.add(ruleId);
        pushAnalysisWarning(warnings, {
          kind: "gate-skipped",
          source: workflowPath,
          message: `Rule ${ruleId} was not evaluated for ${workflowPath} because the workflow is quarantined for this rule.`,
        });
        continue;
      }

      const wfFactsState = getWfFactsState(workflow);
      const rmeta = rule.meta;
      const featurePred =
        rmeta.featurePredicate ??
        (rule as AnyRuleModule & { featurePredicate?: (state: Record<string, unknown>) => boolean })
          .featurePredicate;
      if (featurePred && !featurePred(wfFactsState)) {
        context.measureCompleteness?.skippedGates.add(ruleId);
        pushAnalysisWarning(warnings, {
          kind: "gate-skipped",
          source: workflowPath,
          message: `Rule ${ruleId} was not evaluated for ${workflowPath} because the workflow feature mask did not match.`,
        });
        continue;
      }

      const skipPred = rmeta.skipIf;
      if (skipPred && shouldSkipForWorkflow(skipPred, workflow, context.allWorkflows)) {
        context.measureCompleteness?.skippedGates.add(ruleId);
        pushAnalysisWarning(warnings, {
          kind: "gate-skipped",
          source: workflowPath,
          message: `Rule ${ruleId} was not evaluated for ${workflowPath} because its skipIf predicate matched.`,
        });
        continue;
      }

      if (rule.nodeTypes && !rule.nodeTypes.some((nk) => workflowContainsKind(workflow, nk))) {
        context.measureCompleteness?.skippedGates.add(ruleId);
        pushAnalysisWarning(warnings, {
          kind: "gate-skipped",
          source: workflowPath,
          message: `Rule ${ruleId} was not evaluated for ${workflowPath} because the workflow node types did not match its scope.`,
        });
        continue;
      }

      const workflowSemantics =
        context.workflowSemantics instanceof Map
          ? context.workflowSemantics.get(workflow as never)
          : context.workflowSemantics;
      const perWorkflowContext: RuleContext =
        workflowSemantics !== undefined ? { ...context, workflowSemantics } : context;
      const { diagnostics: rawDiagnostics, errored } = await runRuleSafely(
        ruleId,
        workflowPath,
        context,
        warnings,
        () => rule.check(workflow as never, perWorkflowContext),
      );
      const diagnostics = applyMaxFindings(rawDiagnostics, maxFindings, ruleId, {
        source: workflowPath,
        warnings,
        measureCompleteness: context.measureCompleteness,
      });

      if (!errored && diagnostics.length > 0) {
        firedRuleIds.add(ruleId);
      }

      const workflowIndex = workflowIndexByRef.get(workflow);
      if (workflowIndex !== undefined) {
        const target = workflowResults[workflowIndex]!;
        for (let j = 0; j < diagnostics.length; j++) {
          target.push(diagnostics[j]!);
        }
      }
      if (findingCounts) {
        findingCounts.set(ruleId, (findingCounts.get(ruleId) ?? 0) + diagnostics.length);
      }

      if (!errored && diagnostics.length === 0) {
        pushAnalysisWarning(warnings, {
          kind: "empty-result",
          source: `${workflowPath}#${ruleId}`,
          message: `Rule ${ruleId} ran and found nothing for ${workflowPath}.`,
        });
      }
    }
  }

  let combined: Diagnostic[];
  if (workflowResults.length === 1) {
    combined = workflowResults[0]!;
  } else {
    let totalLen = 0;
    for (let i = 0; i < workflowResults.length; i++) {
      totalLen += workflowResults[i]!.length;
    }
    combined = new Array<Diagnostic>(totalLen);
    let offset = 0;
    for (let i = 0; i < workflowResults.length; i++) {
      const arr = workflowResults[i]!;
      for (let j = 0; j < arr.length; j++) {
        combined[offset++] = arr[j]!;
      }
    }
  }

  driftDetectionRefiner(firedRuleIds, evaluatedRuleIds, inferenceGraph).refine(combined, {
    warnings,
  });

  return deduplicateRefiner().refine(combined, {});
}

function selectTopK(
  workflows: AnyWorkflowDocument[],
  precheck: (workflow: { source?: string }) => number,
  budget: number,
): ScoredWorkflow[] {
  const n = workflows.length;
  if (n === 0 || budget <= 0) {
    return [];
  }

  if (budget >= n) {
    const result = new Array<ScoredWorkflow>(n);
    for (let i = 0; i < n; i++) {
      const w = workflows[i]!;
      const score = precheck(w);
      result[i] = { workflow: w, score };
    }
    return result;
  }

  const top = new Array<{ workflow: AnyWorkflowDocument; score: number }>(budget);
  let filled = 0;

  for (let i = 0; i < n; i++) {
    const w = workflows[i]!;
    const score = precheck(w);
    if (score <= 0) {
      continue;
    }

    if (filled < budget) {
      top[filled++] = { workflow: w, score };
      if (filled === budget) {
        top.sort((a, b) => b.score - a.score);
      }
    } else if (score > top[budget - 1]!.score) {
      let lo = 0;
      let hi = budget;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (top[mid]!.score >= score) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      for (let j = budget - 1; j > lo; j--) {
        top[j] = top[j - 1]!;
      }
      top[lo] = { workflow: w, score };
    }
  }

  if (filled < budget) {
    const result = new Array<ScoredWorkflow>(filled);
    for (let i = 0; i < filled; i++) {
      result[i] = top[i]!;
    }
    return result;
  }

  return top as ScoredWorkflow[];
}
