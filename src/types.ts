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
  message: string;
  why: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: string;
  score: number;
}

export interface AggregatedFinding {
  ruleId: string;
  workflow: string;
  workflows: string[];
  docsPath: string;
  scope?: "workflow" | "repository";
  messages: string[];
  aiHandoffs?: string[];
  locations: string[];
  jobs: string[];
  why: string;
  suggestion: string;
  measurementHint: string;
  firstIndex: number;
}

export interface WorkflowSummary {
  path: string;
  name?: string;
  findings: Diagnostic[];
}

export interface AnalysisWarning {
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
  propagationClusters: PropagationCluster[];
}

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
  precheck?: (workflow: { source?: string }) => number;
  precheckBudget?: number;
}
