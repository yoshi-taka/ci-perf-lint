import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowSemantics } from "../rules/shared/workflow-semantics.ts";

export interface RepositoryDiagnosticGateState {
  hasJavaScriptHeavyWorkflow: boolean;
  hasJavaScriptTooling: boolean;
  hasJavaScriptLinting: boolean;
  hasJavaScriptBuildConfig: boolean;
  hasJavaScriptPackageScripts: boolean;
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
  hasElixirHeavyWorkflow: boolean;
  hasGradle: boolean;
}

export interface RepositoryDiagnosticContext {
  repoRoot: string;
  repository: RepositorySignals;
  workflows: WorkflowDocument[];
  workflowSemantics: ReadonlyMap<WorkflowDocument, WorkflowSemantics>;
  warnings: AnalysisWarning[];
  scanContext: RepositoryScanContext;
}

export type GatePredicate = (state: RepositoryDiagnosticGateState) => boolean;

export interface RepositoryDiagnosticCollector {
  id: string;
  gate: GatePredicate;
  collect: (context: RepositoryDiagnosticContext) => Diagnostic[] | Promise<Diagnostic[]>;
}
