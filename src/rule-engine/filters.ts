/* oxlint-disable typescript/prefer-for-of */
import type { AnalysisWarning } from "../types.ts";
import type { RuleContext, AnyRuleModule, WorkflowNodeKind } from "./types.ts";
import type { AnyWorkflowDocument } from "../ci-types.ts";
import { getWorkflowFacts } from "../rules/shared/workflow-analysis.ts";
import { evaluate as evaluatePredicate, type Predicate } from "../rules/shared/predicate.ts";
import { pushAnalysisWarning } from "./utils.ts";

export function workflowContainsKind(
  workflow: AnyWorkflowDocument,
  kind: WorkflowNodeKind,
): boolean {
  switch (workflow.kind) {
    case "github-actions":
      switch (kind) {
        case "trigger":
          return workflow.on !== undefined;
        case "concurrency":
          return workflow.concurrencyNode !== undefined;
      }
    default:
      return true;
  }
}

export function shouldSkipForWorkflow(
  pred: Predicate,
  workflow: AnyWorkflowDocument,
  allWorkflows?: readonly AnyWorkflowDocument[],
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
