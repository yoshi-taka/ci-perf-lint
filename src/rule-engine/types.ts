import type {
  Diagnostic,
  MeasureCompletenessTracker,
  RuleMeta,
  RuleAbstention,
  EpistemicStatus,
} from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { WorkflowSemantics } from "../rules/shared/workflow-semantics.ts";
import type { RepositoryPrecedentIndex } from "../rules/shared/repository-precedent-index.ts";
import type { RepositoryFileIndex } from "../rules/shared/repository-file-index.ts";
import type { SingularityTracker } from "../rules/shared/singularity.ts";

export type WorkflowNodeKind = "trigger" | "concurrency";

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

export interface RuleModule {
  meta: RuleMeta & { scope?: "github-actions" };
  nodeTypes?: WorkflowNodeKind[];
  check: (workflow: WorkflowDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

export interface BuildkiteRuleModule {
  meta: RuleMeta & { scope: "buildkite" };
  nodeTypes?: WorkflowNodeKind[];
  check: (pipeline: PipelineDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

export interface GitlabCiRuleModule {
  meta: RuleMeta & { scope: "gitlab-ci" };
  nodeTypes?: WorkflowNodeKind[];
  check: (doc: GitlabCiDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

export interface CircleCiRuleModule {
  meta: RuleMeta & { scope: "circleci" };
  nodeTypes?: WorkflowNodeKind[];
  check: (doc: CircleCiDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

export interface BothRuleModule {
  meta: RuleMeta & { scope: "all" };
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

export type AnyCheckFn = (
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
  context: RuleContext,
) => Diagnostic[] | Promise<Diagnostic[]>;

export interface ScoredWorkflow {
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument;
  score: number;
}
