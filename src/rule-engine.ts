import type {
  AnalysisWarning,
  Diagnostic,
  MeasureCompletenessTracker,
  RequiredFeatures,
  RuleMeta,
  RuleAbstention,
  EpistemicStatus,
} from "./types.ts";
import type { RepositorySignals } from "./repository-signals-types.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";
import type { WorkflowDocument } from "./workflow.ts";
import type { PipelineDocument } from "./buildkite-workflow.ts";
import type { GitlabCiDocument } from "./gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "./circleci-workflow.ts";
import type { WorkflowSemantics } from "./rules/shared/workflow-semantics.ts";
import type { RepositoryPrecedentIndex } from "./rules/shared/repository-precedent-index.ts";
import type { RepositoryFileIndex } from "./rules/shared/repository-file-index.ts";
import { prewarmStepAnalysisCaches } from "./rules/shared/step-analysis-prewarm.ts";
import {
  composeRefiners,
  deduplicateRefiner,
  driftDetectionRefiner,
  maxFindingsRefiner,
} from "./refiner-pipeline.ts";
import { classifySingularity, type SingularityTracker } from "./rules/shared/singularity.ts";
import { getWorkflowFacts } from "./rules/shared/workflow-analysis.ts";
import { buildInferenceGraph } from "./rules/shared/remediation-checks.ts";
import { evaluate as evaluatePredicate, type Predicate } from "./rules/shared/predicate.ts";

type WorkflowNodeKind = "trigger" | "concurrency";

let _rulesByScope: Record<string, readonly AnyRuleModule[]> | null = null;

const analysisWarningsEnabled = process.env.CI_PERF_LINT_DUMP_STATE === "1";

async function getRulesByScope(): Promise<Record<string, readonly AnyRuleModule[]>> {
  if (!_rulesByScope) {
    const mod = await import("./rules/index.ts");
    _rulesByScope = mod.rulesByScope;
  }
  return _rulesByScope;
}

function pushAnalysisWarning(
  warnings: AnalysisWarning[] | undefined,
  warning: AnalysisWarning,
): void {
  if (analysisWarningsEnabled && warnings) {
    warnings.push(warning);
  }
}

export interface RuleContext {
  repository: RepositorySignals;
  scanContext?: RepositoryScanContext;
  workflowSemantics?: WorkflowSemantics | ReadonlyMap<WorkflowDocument, WorkflowSemantics>;
  precedentIndex?: RepositoryPrecedentIndex;
  fileIndex?: RepositoryFileIndex;
  singularities?: SingularityTracker;
  measureCompleteness?: MeasureCompletenessTracker;
  abstain?: (abstention: Omit<RuleAbstention, "epistemicStatus">, status?: EpistemicStatus) => void;
  allWorkflows?: readonly WorkflowDocument[];
}

interface RuleModule {
  meta: RuleMeta;
  nodeTypes?: WorkflowNodeKind[];
  check: (workflow: WorkflowDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

interface BuildkiteRuleModule {
  meta: RuleMeta;
  nodeTypes?: WorkflowNodeKind[];
  check: (pipeline: PipelineDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

interface GitlabCiRuleModule {
  meta: RuleMeta;
  nodeTypes?: WorkflowNodeKind[];
  check: (doc: GitlabCiDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

interface CircleCiRuleModule {
  meta: RuleMeta;
  nodeTypes?: WorkflowNodeKind[];
  check: (doc: CircleCiDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

interface BothRuleModule {
  meta: RuleMeta;
  nodeTypes?: WorkflowNodeKind[];
  check: (
    workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
    context: RuleContext,
  ) => Diagnostic[] | Promise<Diagnostic[]>;
}

export type AnyRuleModule =
  | RuleModule
  | BuildkiteRuleModule
  | BothRuleModule
  | GitlabCiRuleModule
  | CircleCiRuleModule;

function isPipelineDocument(doc: unknown): doc is PipelineDocument {
  return typeof doc === "object" && doc !== null && "steps" in doc && !("jobs" in doc);
}

function isGitlabCiDocument(doc: unknown): doc is GitlabCiDocument {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "kind" in doc &&
    (doc as Record<string, unknown>).kind === "gitlab-ci"
  );
}

function isCircleCiDocument(doc: unknown): doc is CircleCiDocument {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "kind" in doc &&
    (doc as Record<string, unknown>).kind === "circleci"
  );
}

function getRuleCheckFn(
  rule: AnyRuleModule,
  isBuildkite: boolean,
  isGitlab: boolean,
  isCircle: boolean,
): (
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
  context: RuleContext,
) => Promise<Diagnostic[]> {
  const scope = rule.meta.scope ?? "github-actions";

  if (scope === "all") {
    return (rule as BothRuleModule).check as never;
  }
  if (scope === "buildkite") {
    return isBuildkite ? ((rule as BuildkiteRuleModule).check as never) : () => Promise.resolve([]);
  }
  if (scope === "gitlab-ci") {
    return isGitlab ? ((rule as GitlabCiRuleModule).check as never) : () => Promise.resolve([]);
  }
  if (scope === "circleci") {
    return isCircle ? ((rule as CircleCiRuleModule).check as never) : () => Promise.resolve([]);
  }
  return !isBuildkite && !isGitlab && !isCircle
    ? ((rule as RuleModule).check as never)
    : () => Promise.resolve([]);
}

function workflowContainsKind(
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
  kind: WorkflowNodeKind,
): boolean {
  if ("on" in workflow) {
    switch (kind) {
      case "trigger":
        return workflow.on !== undefined;
      case "concurrency":
        return workflow.concurrencyNode !== undefined;
    }
  }
  return true;
}

function ruleMatchesScope(
  rule: AnyRuleModule,
  isBuildkite: boolean,
  isGitlab: boolean,
  isCircle: boolean,
): boolean {
  const scope = rule.meta.scope ?? "github-actions";
  if (scope === "all") {
    return true;
  }
  if (scope === "buildkite") {
    return isBuildkite;
  }
  if (scope === "gitlab-ci") {
    return isGitlab;
  }
  if (scope === "circleci") {
    return isCircle;
  }
  return !isBuildkite && !isGitlab && !isCircle;
}

function shouldSkipForWorkflow(
  pred: Predicate,
  workflow: WorkflowDocument,
  allWorkflows?: readonly WorkflowDocument[],
): boolean {
  const wfFacts = getWorkflowFacts(workflow);
  const ctx = {
    workflow,
    workflowFacts: wfFacts,
    source: workflow.source ?? "",
    workflows: allWorkflows,
  };
  return evaluatePredicate(pred, ctx);
}

function runConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = index++;
      if (i >= items.length) {
        break;
      }
      results[i] = await fn(items[i]!);
    }
  });
  return Promise.all(workers).then(() => results);
}

function matchesFeatureMask(
  features: RequiredFeatures | undefined,
  workflow: WorkflowDocument,
): boolean {
  if (!features) {
    return true;
  }

  const wfFacts = getWorkflowFacts(workflow);

  if (features.workflowFacts) {
    for (const [key, required] of Object.entries(features.workflowFacts)) {
      const actual = (wfFacts as unknown as Record<string, unknown>)[key];
      if (actual !== required) {
        return false;
      }
    }
  }

  if (features.toolPresence) {
    for (const [key, required] of Object.entries(features.toolPresence)) {
      if ((wfFacts.toolPresence.get(key) ?? false) !== required) {
        return false;
      }
    }
  }

  return true;
}

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
    if (ruleFilter && !ruleFilter(rule)) {
      context.measureCompleteness?.skippedGates.add(rule.meta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: workflowPath,
        message: `Rule ${rule.meta.id} was not evaluated because the rule filter excluded it.`,
      });
      continue;
    }

    if (context.singularities?.isQuarantined(rule.meta.id)) {
      context.measureCompleteness?.skippedGates.add(rule.meta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: workflowPath,
        message: `Rule ${rule.meta.id} was not evaluated because it is quarantined by singularity handling.`,
      });
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
      try {
        return { diagnostics: await task.run(), rule: task.rule, errored: false };
      } catch (error) {
        const failure = classifySingularity(error, task.rule.meta.id, workflowPath);
        context.singularities?.record(failure);
        if (warnings) {
          const detail = error instanceof Error ? error.message : String(error);
          warnings.push({
            kind: "rule-error",
            source: workflowPath,
            message: `[${failure.class}] Rule ${task.rule.meta.id} failed: ${detail}`,
          });
        }
        return { diagnostics: [], rule: task.rule, errored: true };
      }
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

interface ScoredWorkflow {
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument;
  score: number;
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
    if (ruleFilter && !ruleFilter(rule)) {
      context.measureCompleteness?.skippedGates.add(rule.meta.id);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: rule.meta.id,
        message: `Rule ${rule.meta.id} was not evaluated because the rule filter excluded it.`,
      });
      continue;
    }

    const ruleId = rule.meta.id;
    if (context.singularities?.isQuarantined(ruleId)) {
      context.measureCompleteness?.skippedGates.add(ruleId);
      pushAnalysisWarning(warnings, {
        kind: "gate-skipped",
        source: ruleId,
        message: `Rule ${ruleId} was not evaluated because it is quarantined by singularity handling.`,
      });
      continue;
    }

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
      let errored = false;
      let diagnostics: Diagnostic[] = [];
      try {
        diagnostics = await checkFn(workflow, perWorkflowContext);
        if (diagnostics.length > 0) {
          firedRuleIds.add(ruleId);
        }
        if (maxFindings !== undefined && diagnostics.length > maxFindings) {
          context.measureCompleteness?.maxFindingsHitRules.add(ruleId);
          pushAnalysisWarning(warnings, {
            kind: "max-findings-hit",
            source: workflowPath,
            message: `Rule ${ruleId} produced ${diagnostics.length} findings and was capped at ${maxFindings}.`,
          });
          diagnostics.length = maxFindings;
        }
        const workflowIndex = workflowIndexByRef.get(workflow);
        if (workflowIndex !== undefined) {
          workflowResults[workflowIndex]!.push(...diagnostics);
        }
        if (findingCounts) {
          findingCounts.set(ruleId, (findingCounts.get(ruleId) ?? 0) + diagnostics.length);
        }
      } catch (error) {
        errored = true;
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
