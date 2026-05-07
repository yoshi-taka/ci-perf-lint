import type { AnalysisWarning, Diagnostic, RuleMeta } from "./types.ts";
import type { RepositorySignals } from "./repository-signals-types.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";
import type { WorkflowDocument } from "./workflow.ts";
import type { PipelineDocument } from "./buildkite-workflow.ts";
import type { GitlabCiDocument } from "./gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "./circleci-workflow.ts";
import type { WorkflowSemantics } from "./rules/shared/workflow-semantics.ts";
import { prewarmStepAnalysisCaches } from "./rules/shared/step-analysis-prewarm.ts";

type WorkflowNodeKind = "trigger" | "concurrency";

let _rulesByScope: Record<string, readonly AnyRuleModule[]> | null = null;

async function getRulesByScope(): Promise<Record<string, readonly AnyRuleModule[]>> {
  if (!_rulesByScope) {
    const mod = await import("./rules/index.ts");
    _rulesByScope = mod.rulesByScope;
  }
  return _rulesByScope;
}

export interface RuleContext {
  repository: RepositorySignals;
  scanContext?: RepositoryScanContext;
  workflowSemantics?: WorkflowSemantics;
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
  let applicableRules: readonly AnyRuleModule[];
  if (isBuildkite) {
    applicableRules = [...(rulesByScope.buildkite ?? []), ...(rulesByScope.both ?? [])];
  } else if (isGitlab) {
    applicableRules = [...(rulesByScope["gitlab-ci"] ?? []), ...(rulesByScope.both ?? [])];
  } else if (isCircle) {
    applicableRules = [...(rulesByScope.circleci ?? []), ...(rulesByScope.both ?? [])];
  } else {
    applicableRules = [...(rulesByScope["github-actions"] ?? []), ...(rulesByScope.both ?? [])];
  }

  const ruleResults: Diagnostic[] = [];

  for (const rule of applicableRules) {
    if (ruleFilter && !ruleFilter(rule)) {
      continue;
    }

    const { maxFindings } = rule.meta;
    if (
      maxFindings !== undefined &&
      findingCounts &&
      (findingCounts.get(rule.meta.id) ?? 0) >= maxFindings
    ) {
      continue;
    }

    if (rule.nodeTypes && !rule.nodeTypes.some((kind) => workflowContainsKind(workflow, kind))) {
      continue;
    }

    const prevLen = ruleResults.length;

    try {
      const ruleScope = rule.meta.scope ?? "github-actions";
      if (ruleScope === "both") {
        const bothRule = rule as BothRuleModule;
        ruleResults.push(...(await bothRule.check(workflow, context)));
      } else if (isBuildkite) {
        const buildkiteRule = rule as BuildkiteRuleModule;
        ruleResults.push(...(await buildkiteRule.check(workflow, context)));
      } else if (isGitlab) {
        const gitlabCiRule = rule as GitlabCiRuleModule;
        ruleResults.push(...(await gitlabCiRule.check(workflow, context)));
      } else if (isCircle) {
        const circleCiRule = rule as CircleCiRuleModule;
        ruleResults.push(...(await circleCiRule.check(workflow, context)));
      } else {
        const githubRule = rule as RuleModule;
        ruleResults.push(...(await githubRule.check(workflow, context)));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (warnings) {
        warnings.push({
          source: workflow.relativePath,
          message: `Rule ${rule.meta.id} failed: ${detail}`,
        });
      }
    }

    if (findingCounts) {
      const added = ruleResults.length - prevLen;
      if (added > 0) {
        findingCounts.set(rule.meta.id, (findingCounts.get(rule.meta.id) ?? 0) + added);
      }
    }
  }

  return ruleResults;
}
