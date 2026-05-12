import type { AnalysisWarning, RequiredFeatures } from "../types.ts";
import type { RuleContext, AnyRuleModule, WorkflowNodeKind } from "./types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import { getWorkflowFacts } from "../rules/shared/workflow-analysis.ts";
import { evaluate as evaluatePredicate, type Predicate } from "../rules/shared/predicate.ts";
import { pushAnalysisWarning } from "./utils.ts";

export function isPipelineDocument(doc: unknown): doc is PipelineDocument {
  return typeof doc === "object" && doc !== null && "steps" in doc && !("jobs" in doc);
}

export function isGitlabCiDocument(doc: unknown): doc is GitlabCiDocument {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "kind" in doc &&
    (doc as Record<string, unknown>).kind === "gitlab-ci"
  );
}

export function isCircleCiDocument(doc: unknown): doc is CircleCiDocument {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "kind" in doc &&
    (doc as Record<string, unknown>).kind === "circleci"
  );
}

export function workflowContainsKind(
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

export function ruleMatchesScope(
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

export function shouldSkipForWorkflow(
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

export function matchesFeatureMask(
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

export function shouldEvaluateRule(
  rule: AnyRuleModule,
  context: RuleContext,
  source: string,
  warnings: AnalysisWarning[] | undefined,
  ruleFilter?: (rule: AnyRuleModule) => boolean,
): boolean {
  if (ruleFilter && !ruleFilter(rule)) {
    context.measureCompleteness?.skippedGates.add(rule.meta.id);
    pushAnalysisWarning(warnings, {
      kind: "gate-skipped",
      source,
      message: `Rule ${rule.meta.id} was not evaluated because the rule filter excluded it.`,
    });
    return false;
  }

  if (context.singularities?.isQuarantined(rule.meta.id)) {
    context.measureCompleteness?.skippedGates.add(rule.meta.id);
    pushAnalysisWarning(warnings, {
      kind: "gate-skipped",
      source,
      message: `Rule ${rule.meta.id} was not evaluated because it is quarantined by singularity handling.`,
    });
    return false;
  }

  return true;
}
