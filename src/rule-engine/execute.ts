import type {
  AnalysisWarning,
  Diagnostic,
  MeasureCompletenessTracker,
  RuleMeta,
} from "../types.ts";
import type { RuleContext, AnyRuleModule, ScoredWorkflow } from "./types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import { prewarmStepAnalysisCaches } from "../rules/shared/step-analysis-prewarm.ts";
import {
  composeRefiners,
  deduplicateRefiner,
  driftDetectionRefiner,
  maxFindingsRefiner,
} from "../refiner-pipeline.ts";
import { classifySingularity } from "../rules/shared/singularity.ts";
import { buildInferenceGraph } from "../rules/shared/remediation-checks.ts";
import { getRulesByScope, pushAnalysisWarning, runConcurrent } from "./utils.ts";
import {
  isPipelineDocument,
  isGitlabCiDocument,
  isCircleCiDocument,
  workflowContainsKind,
  ruleMatchesScope,
  matchesFeatureMask,
  shouldSkipForWorkflow,
  shouldEvaluateRule,
} from "./filters.ts";
import { getRuleCheckFn } from "./rule-dispatch.ts";

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
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
  context: RuleContext,
  warnings?: AnalysisWarning[],
  findingCounts?: Map<string, number>,
  ruleFilter?: (rule: AnyRuleModule) => boolean,
): Promise<Diagnostic[]> {
  prewarmStepAnalysisCaches(workflow);
  const isBuildkite = isPipelineDocument(workflow);
  const isGitlab = isGitlabCiDocument(workflow);
  const isCircle = isCircleCiDocument(workflow);

  const { createScopeGateState } = await import("./scope-gate.ts");
  const scopeGateState = createScopeGateState(isBuildkite, isGitlab, isCircle);

  if (scopeGateDebugEnabled) {
    process.stderr.write(
      `${JSON.stringify({
        type: "scope-gate-state",
        workflowPath: workflow.relativePath,
        isBuildkite,
        isGitlab,
        isCircle,
        gateState: scopeGateState,
      })}\n`,
    );
  }

  const rulesByScope = await getRulesByScope();
  const allRules = [
    ...(rulesByScope["github-actions"] ?? []),
    ...(rulesByScope.buildkite ?? []),
    ...(rulesByScope["gitlab-ci"] ?? []),
    ...(rulesByScope.circleci ?? []),
    ...(rulesByScope.all ?? []),
  ];

  interface RuleTask {
    rule: AnyRuleModule;
    run: () => Promise<Diagnostic[]>;
  }

  interface RuleRunResult {
    rule: AnyRuleModule;
    diagnostics: Diagnostic[];
    errored: boolean;
  }

  const inferenceGraph = buildInferenceGraph(allRules);
  const tasks: RuleTask[] = [];
  const evaluatedRuleIds = new Set<string>();
  const workflowPath = workflow.relativePath;

  for (const rule of allRules) {
    if (!shouldEvaluateRule(rule, context, workflowPath, warnings, ruleFilter)) {
      continue;
    }

    if (!matchesFeatureMask(rule.meta.requiredFeatures, workflow as WorkflowDocument)) {
      context.measureCompleteness?.skippedGates.add(rule.meta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: workflowPath,
        message: `Rule ${rule.meta.id} was not evaluated because the workflow feature mask did not match.`,
      });
      continue;
    }

    if (rule.nodeTypes && !rule.nodeTypes.some((kind) => workflowContainsKind(workflow, kind))) {
      context.measureCompleteness?.skippedGates.add(rule.meta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: workflowPath,
        message: `Rule ${rule.meta.id} was not evaluated because the workflow node types did not match its scope.`,
      });
      continue;
    }

    if (!ruleMatchesScope(rule, isBuildkite, isGitlab, isCircle)) {
      context.measureCompleteness?.skippedGates.add(rule.meta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: workflowPath,
        message: `Rule ${rule.meta.id} was not evaluated because its scope does not apply to this document.`,
      });
      continue;
    }

    const rmeta: RuleMeta = rule.meta;
    const skipPred = rmeta.skipIf;
    if (
      skipPred &&
      shouldSkipForWorkflow(skipPred, workflow as WorkflowDocument, context.allWorkflows)
    ) {
      context.measureCompleteness?.skippedGates.add(rule.meta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: workflowPath,
        message: `Rule ${rule.meta.id} was not evaluated because its skipIf predicate matched.`,
      });
      continue;
    }

    const checkFn = getRuleCheckFn(rule, isBuildkite, isGitlab, isCircle);
    evaluatedRuleIds.add(rule.meta.id);
    tasks.push({ rule, run: () => Promise.resolve(checkFn(workflow, context)) });
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

  for (const { diagnostics, rule, errored } of settled as RuleRunResult[]) {
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
    ruleResults.push(...diagnostics);
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

  const refiners = composeRefiners([maxFindingsRefiner(idMaxFindings, impliedIds)]);
  const filtered = refiners.refine(ruleResults, {
    warnings,
    measureCompleteness: context.measureCompleteness,
    workflowPath,
  });

  if (findingCounts) {
    for (const d of filtered) {
      findingCounts.set(d.ruleId, (findingCounts.get(d.ruleId) ?? 0) + 1);
    }
  }

  return filtered;
}

export async function evaluateRulesCoarseToFine(
  workflows: (WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument)[],
  context: RuleContext,
  warnings?: AnalysisWarning[],
  findingCounts?: Map<string, number>,
  ruleFilter?: (rule: AnyRuleModule) => boolean,
): Promise<Diagnostic[]> {
  if (workflows.length === 0) {
    return [];
  }
  const isBuildkite = isPipelineDocument(workflows[0]!);
  const isGitlab = isGitlabCiDocument(workflows[0]!);
  const isCircle = isCircleCiDocument(workflows[0]!);

  const rulesByScope = await getRulesByScope();
  const allRules = [
    ...(rulesByScope["github-actions"] ?? []),
    ...(rulesByScope.buildkite ?? []),
    ...(rulesByScope["gitlab-ci"] ?? []),
    ...(rulesByScope.circleci ?? []),
    ...(rulesByScope.all ?? []),
  ];

  const inferenceGraph = buildInferenceGraph(allRules);
  const evaluatedRuleIds = new Set<string>();
  const firedRuleIds = new Set<string>();

  const workflowResults = workflows.map(() => [] as Diagnostic[]);
  const workflowIndexByRef = new Map<
    WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
    number
  >();
  for (const [index, workflow] of workflows.entries()) {
    workflowIndexByRef.set(workflow, index);
  }

  for (const rule of allRules) {
    if (!shouldEvaluateRule(rule, context, rule.meta.id, warnings, ruleFilter)) {
      continue;
    }

    const ruleId = rule.meta.id;

    evaluatedRuleIds.add(ruleId);

    const { maxFindings, precheckBudget = 20 } = rule.meta;

    const checkFn = getRuleCheckFn(rule, isBuildkite, isGitlab, isCircle);
    const precheck = rule.meta.precheck;

    let candidates: ScoredWorkflow[];
    if (precheck) {
      const scored = workflows.map((w) => ({ workflow: w, score: precheck(w) }));
      candidates = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, precheckBudget);
    } else {
      candidates = workflows.map((w) => ({ workflow: w, score: 1 }));
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

    for (const { workflow } of candidates) {
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

      if (!matchesFeatureMask(rule.meta.requiredFeatures, workflow as WorkflowDocument)) {
        context.measureCompleteness?.skippedGates.add(ruleId);
        pushAnalysisWarning(warnings, {
          kind: "gate-skipped",
          source: workflowPath,
          message: `Rule ${ruleId} was not evaluated for ${workflowPath} because the workflow feature mask did not match.`,
        });
        continue;
      }

      const rmetaB: RuleMeta = rule.meta;
      const skipPred = rmetaB.skipIf;
      if (
        skipPred &&
        shouldSkipForWorkflow(skipPred, workflow as WorkflowDocument, context.allWorkflows)
      ) {
        context.measureCompleteness?.skippedGates.add(ruleId);
        pushAnalysisWarning(warnings, {
          kind: "gate-skipped",
          source: workflowPath,
          message: `Rule ${ruleId} was not evaluated for ${workflowPath} because its skipIf predicate matched.`,
        });
        continue;
      }

      prewarmStepAnalysisCaches(workflow);
      if (rule.nodeTypes && !rule.nodeTypes.some((kind) => workflowContainsKind(workflow, kind))) {
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
          ? context.workflowSemantics.get(workflow as WorkflowDocument)
          : context.workflowSemantics;
      const perWorkflowContext: RuleContext =
        workflowSemantics !== undefined ? { ...context, workflowSemantics } : context;
      const { diagnostics: rawDiagnostics, errored } = await runRuleSafely(
        ruleId,
        workflowPath,
        context,
        warnings,
        () => checkFn(workflow, perWorkflowContext),
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
        workflowResults[workflowIndex]!.push(...diagnostics);
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

  driftDetectionRefiner(firedRuleIds, evaluatedRuleIds, inferenceGraph).refine(
    workflowResults.flat(),
    { warnings },
  );

  return deduplicateRefiner().refine(workflowResults.flat(), {});
}
