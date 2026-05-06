import type { AnalysisWarning, Diagnostic, RuleMeta } from "./types.ts";
import type { RepositorySignals } from "./repository-signals-types.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";
import type { WorkflowDocument } from "./workflow.ts";
import type { PipelineDocument } from "./buildkite-workflow.ts";
import type { GitlabCiDocument } from "./gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "./circleci-workflow.ts";
import { prewarmStepAnalysisCaches } from "./rules/shared/step-analysis-prewarm.ts";

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
}

interface RuleModule {
  meta: RuleMeta;
  check: (workflow: WorkflowDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

interface BuildkiteRuleModule {
  meta: RuleMeta;
  check: (pipeline: PipelineDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

interface GitlabCiRuleModule {
  meta: RuleMeta;
  check: (doc: GitlabCiDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

interface CircleCiRuleModule {
  meta: RuleMeta;
  check: (doc: CircleCiDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

interface BothRuleModule {
  meta: RuleMeta;
  check: (
    workflow: WorkflowDocument | PipelineDocument,
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
    applicableRules = rulesByScope["gitlab-ci"] ?? [];
  } else if (isCircle) {
    applicableRules = rulesByScope.circleci ?? [];
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

    const prevLen = ruleResults.length;

    try {
      const ruleScope = rule.meta.scope ?? "github-actions";
      if (ruleScope === "both") {
        const bothRule = rule as BothRuleModule;
        ruleResults.push(
          ...(await bothRule.check(workflow as WorkflowDocument | PipelineDocument, context)),
        );
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
