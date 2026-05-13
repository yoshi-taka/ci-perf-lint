import type { RepairOp } from "./reification.ts";
import type { DiagnosticSource, DiagnosticSourceKind } from "./diagnostic-source.ts";

export type Severity = "error" | "warning" | "suggestion";
export type Confidence = "high" | "medium";
export type OutputFormat = "handoff" | "text" | "json" | "markdown";
export type AuditMode = "strict" | "exploratory";

export interface RenderOptions {
  findingsOnly?: boolean;
  topCount?: number;
  mode?: AuditMode;
  showAllLocations?: boolean;
  hyperlinks?: boolean;
  colors?: boolean;
  cwd?: string;
}

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
}

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  scope?: "workflow" | "repository";
  docsPath: string;
  workflow: string;
  location: SourceLocation;
  source?: DiagnosticSource;
  message: string;
  why: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: string;
  score: number;
  repair?: RepairOp;
}

export interface AggregatedFinding {
  ruleId: string;
  workflow: string;
  workflows: string[];
  docsPath: string;
  scope?: "workflow" | "repository";
  sourceKinds?: DiagnosticSourceKind[];
  messages: string[];
  aiHandoffs?: string[];
  locations: string[];
  jobs: string[];
  why: string;
  suggestion: string;
  measurementHint: string;
  firstIndex: number;
  repair?: RepairOp;
}

export interface WorkflowSummary {
  path: string;
  name?: string;
  findings: Diagnostic[];
}

export type AbstentionReason =
  | "opaque-body"
  | "dynamic-value"
  | "external-dependency"
  | "cross-boundary"
  | "condition-not-met"
  | "recursion-depth-exceeded";

export type EpistemicStatus = "known-absent" | "unknown";

export interface RuleAbstention {
  ruleId: string;
  jobId: string;
  reason: AbstentionReason;
  detail?: string;
  epistemicStatus: EpistemicStatus;
}

export interface MeasureCompleteness {
  totalWorkflows: number;
  evaluatedWorkflows: number;
  skippedRepositoryDiagnostics: boolean;
  skippedGates: string[];
  maxFindingsHitRules: string[];
  parserFailures?: string[];
  workflowOnlyRules?: string[];
  abstentions?: RuleAbstention[];
}

export interface MeasureCompletenessTracker {
  totalWorkflows: number;
  evaluatedWorkflowPaths: Set<string>;
  skippedRepositoryDiagnostics: boolean;
  skippedGates: Set<string>;
  maxFindingsHitRules: Set<string>;
  parserFailures: Set<string>;
  workflowOnlyRules: Set<string>;
  abstentions: RuleAbstention[];
  abstain: (abstention: Omit<RuleAbstention, "epistemicStatus">, status?: EpistemicStatus) => void;
}

export interface AnalysisWarning {
  kind:
    | "rule-error"
    | "collector-error"
    | "gate-skipped"
    | "workflow-only"
    | "max-findings-hit"
    | "empty-result"
    | "parser-error"
    | "remediation-drift"
    | "scan-warning"
    | "refiner-effect";
  source: string;
  message: string;
}

export interface DiffusionMetrics {
  diffusionCoefficient: number;
  weightedDiffusionMass: number;
  propagationDepth: number;
  workflowCentrality: number;
}

export interface SimilarityEdge {
  source: string;
  target: string;
  similarity: number;
}

export interface PropagationCluster {
  ruleId: string;
  sourceWorkflow: string;
  sourceConfidence: "high" | "medium" | "low";
  sourceReason: string;
  memberWorkflows: string[];
  memberCount: number;
  similarityEdges: SimilarityEdge[];
  metrics: DiffusionMetrics;
}

export interface SharedDiagnostic {
  readonly kind: "shared";
  readonly ruleId: string;
  readonly sourceRuleId: string;
  readonly memberWorkflows: string[];
  readonly confidence: "low" | "medium" | "high";
  readonly representativeWorkflow: string;
  readonly representativeLocation: SourceLocation;
  readonly representativeMessage: string;
  readonly severity: Severity;
  readonly score: number;
  readonly why: string;
  readonly suggestion: string;
  readonly measurementHint: string;
  readonly docsPath: string;
}

export interface ReportData {
  targetPath: string;
  workflowCount: number;
  scannedAt: string;
  topFindings: Diagnostic[];
  topAggregatedFindings: AggregatedFinding[];
  findings: Diagnostic[];
  workflows: WorkflowSummary[];
  fixFirst: string[];
  aiHandoff: string[];
  analysisWarnings: AnalysisWarning[];
  measureCompleteness?: MeasureCompleteness;
  propagationClusters: PropagationCluster[];
  sharedDiagnostics?: SharedDiagnostic[];
  remediationChecks: ImpliedCheck[];
}

export interface ImpliedCheck {
  sourceRuleId: string;
  impliedRuleId: string;
  reason: string;
}

type _WorkflowFactsProjectionKeys = {
  isHeavyWorkflow: boolean;
  hasConcurrency: boolean;
  looksMetaCheckLike: boolean;
  looksAgenticLike: boolean;
  looksReleaseLike: boolean;
};

export type WorkflowFactsProjection = Readonly<
  Partial<Record<keyof _WorkflowFactsProjectionKeys, boolean>>
>;

export interface RequiredFeatures {
  readonly workflowFacts?: WorkflowFactsProjection;
  readonly toolPresence?: Readonly<Record<string, boolean>>;
}

import type { Predicate } from "./rules/shared/predicate.ts";
import type { RuleImplication, RuleScheduling } from "./rule-engine/implication.ts";

export interface RuleMeta {
  id: string;
  severity: Severity;
  confidence: Confidence;
  docsPath: string;
  scope?: "github-actions" | "buildkite" | "gitlab-ci" | "circleci" | "all";
  maxFindings?: number;
  requires?: {
    isHeavy?: boolean;
  };
  requiredFeatures?: RequiredFeatures;
  skipIf?: Predicate;
  precheck?: (workflow: { source?: string }) => number;
  precheckBudget?: number;
  impliedChecks?: readonly string[];
  implications?: readonly RuleImplication[];
  scheduling?: RuleScheduling;
}
