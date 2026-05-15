import type {
  Diagnostic,
  MeasureCompletenessTracker,
  RuleMeta,
  RuleAbstention,
  EpistemicStatus,
  FeatureMaskPredicate,
} from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { AnyWorkflowDocument, CiKind } from "../ci-types.ts";
import type { WorkflowSemantics } from "../rules/shared/workflow-semantics.ts";
import type { RepositoryPrecedentIndex } from "../rules/shared/repository-precedent-index.ts";
import type { RepositoryFileIndex } from "../rules/shared/repository-file-index.ts";
import type { SingularityTracker } from "../rules/shared/singularity.ts";

export type WorkflowNodeKind = "trigger" | "concurrency";

export interface RuleContext {
  repository: RepositorySignals;
  scanContext?: RepositoryScanContext;
  workflowSemantics?: WorkflowSemantics | ReadonlyMap<AnyWorkflowDocument, WorkflowSemantics>;
  precedentIndex?: RepositoryPrecedentIndex;
  fileIndex?: RepositoryFileIndex;
  singularities?: SingularityTracker;
  measureCompleteness?: MeasureCompletenessTracker;
  abstain?: (abstention: Omit<RuleAbstention, "epistemicStatus">, status?: EpistemicStatus) => void;
  allWorkflows?: readonly WorkflowDocument[];
}

interface RuleBase {
  meta: RuleMeta;
  nodeTypes?: WorkflowNodeKind[];
  featurePredicate?: FeatureMaskPredicate;
}

export interface RuleModule extends RuleBase {
  meta: RuleMeta & { scope?: "github-actions" };
  check: (workflow: WorkflowDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

export interface BuildkiteRuleModule extends RuleBase {
  meta: RuleMeta & { scope: "buildkite" };
  check: (pipeline: PipelineDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

export interface GitlabCiRuleModule extends RuleBase {
  meta: RuleMeta & { scope: "gitlab-ci" };
  check: (doc: GitlabCiDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

export interface CircleCiRuleModule extends RuleBase {
  meta: RuleMeta & { scope: "circleci" };
  check: (doc: CircleCiDocument, context: RuleContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

export interface BothRuleModule extends RuleBase {
  meta: RuleMeta & { scope: "all" };
  check: (
    workflow: AnyWorkflowDocument,
    context: RuleContext,
  ) => Diagnostic[] | Promise<Diagnostic[]>;
}

export type AnyRuleModule =
  | RuleModule
  | BuildkiteRuleModule
  | BothRuleModule
  | GitlabCiRuleModule
  | CircleCiRuleModule;

export type RulesByKind = Record<CiKind, readonly AnyRuleModule[]>;

export interface ScoredWorkflow {
  workflow: AnyWorkflowDocument;
  score: number;
}
