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

  interface RuleTask {
    rule: AnyRuleModule;
    run: () => Promise<Diagnostic[]>;
  }

  const tasks: RuleTask[] = [];

  for (const rule of applicableRules) {
    if (ruleFilter && !ruleFilter(rule)) {
      continue;
    }

    if (rule.nodeTypes && !rule.nodeTypes.some((kind) => workflowContainsKind(workflow, kind))) {
      continue;
    }

    const ruleScope = rule.meta.scope ?? "github-actions";
    let run: () => Promise<Diagnostic[]>;
    if (ruleScope === "both") {
      const bothRule = rule as BothRuleModule;
      run = () => Promise.resolve(bothRule.check(workflow, context));
    } else if (isBuildkite) {
      const buildkiteRule = rule as BuildkiteRuleModule;
      run = () => Promise.resolve(buildkiteRule.check(workflow, context));
    } else if (isGitlab) {
      const gitlabCiRule = rule as GitlabCiRuleModule;
      run = () => Promise.resolve(gitlabCiRule.check(workflow, context));
    } else if (isCircle) {
      const circleCiRule = rule as CircleCiRuleModule;
      run = () => Promise.resolve(circleCiRule.check(workflow, context));
    } else {
      const githubRule = rule as RuleModule;
      run = () => Promise.resolve(githubRule.check(workflow, context));
    }

    tasks.push({ rule, run });
  }

  const settled = await runConcurrent(
    tasks,
    async (task) => {
      try {
        return { diagnostics: await task.run(), rule: task.rule };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (warnings) {
          warnings.push({
            source: workflow.relativePath,
            message: `Rule ${task.rule.meta.id} failed: ${detail}`,
          });
        }
        return { diagnostics: [], rule: task.rule };
      }
    },
    4,
  );

  const ruleResults: Diagnostic[] = [];
  const idMaxFindings = new Map<string, number>();

  for (const { diagnostics, rule } of settled) {
    const { maxFindings } = rule.meta;
    if (maxFindings !== undefined) {
      idMaxFindings.set(rule.meta.id, maxFindings);
    }
    ruleResults.push(...diagnostics);
  }

  if (findingCounts || idMaxFindings.size > 0) {
    const caps = new Map<string, number>();
    const filtered = ruleResults.filter((d) => {
      const max = idMaxFindings.get(d.ruleId);
      if (max === undefined) {
        return true;
      }
      const count = caps.get(d.ruleId) ?? 0;
      if (count >= max) {
        return false;
      }
      caps.set(d.ruleId, count + 1);
      return true;
    });

    if (findingCounts) {
      for (const [id, count] of caps) {
        findingCounts.set(id, (findingCounts.get(id) ?? 0) + count);
      }
    }

    return filtered;
  }

  return deduplicateByPathLine(ruleResults);
}

function deduplicateByPathLine(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();

  for (const d of diagnostics) {
    const key = `${d.location.path}:${d.location.line}`;
    if (!seen.has(key)) {
      seen.set(key, d);
    }
  }

  return [...seen.values()];
}
