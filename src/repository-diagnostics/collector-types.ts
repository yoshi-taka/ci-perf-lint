import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";

export type RepositoryDiagnosticGate =
  | "javascript-heavy"
  | "javascript-tooling"
  | "docker-heavy"
  | "terraform-heavy"
  | "large-files"
  | "datadog-heavy"
  | "pytest"
  | "python-heavy"
  | "renovate"
  | "husky"
  | "javascript-frameworks"
  | "rust"
  | "cdk-manifest"
  | "cdk-bucket-deployment"
  | "elixir-heavy";

export interface RepositoryDiagnosticGateState {
  hasJavaScriptHeavyWorkflow: boolean;
  hasJavaScriptTooling: boolean;
  hasDockerHeavyWorkflow: boolean;
  hasTerraformHeavyWorkflow: boolean;
  hasLargeFiles: boolean;
  hasDatadogHeavyWorkflow: boolean;
  hasPytest: boolean;
  hasPythonHeavyWorkflow: boolean;
  hasRenovateConfig: boolean;
  hasHusky: boolean;
  hasJavaScriptFrameworks: boolean;
  hasRust: boolean;
  hasCdkManifest: boolean;
  hasCdkBucketDeployment: boolean;
  hasElixirHeavyWorkflow: boolean;
}

export interface RepositoryDiagnosticContext {
  repoRoot: string;
  repository: RepositorySignals;
  workflows: WorkflowDocument[];
  warnings: AnalysisWarning[];
  scanContext: RepositoryScanContext;
}

export interface RepositoryDiagnosticCollector {
  id: string;
  gate: RepositoryDiagnosticGate;
  collect: (context: RepositoryDiagnosticContext) => Diagnostic[] | Promise<Diagnostic[]>;
}
