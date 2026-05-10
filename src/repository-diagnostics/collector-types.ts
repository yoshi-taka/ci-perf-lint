import type { AnalysisWarning, Diagnostic, MeasureCompletenessTracker } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowSemantics } from "../rules/shared/workflow-semantics.ts";
import type { RepositoryFileIndex } from "../rules/shared/repository-file-index.ts";
import type { RepositoryPredicateIndex } from "../rules/shared/repository-predicate-index.ts";
import type { RepositoryFeatureIndex } from "./repository-feature-index.ts";
import type { RepositoryCorpusIndex } from "../rules/shared/repository-corpus-index.ts";

export type GateKey = keyof RepositoryDiagnosticGateState;

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

export interface GateProofs {
  hasJavaScriptHeavyWorkflow?: HasJavaScriptHeavyWorkflowProof;
  hasJavaScriptTooling?: HasJavaScriptToolingProof;
  hasJavaScriptLinting?: HasJavaScriptLintingProof;
  hasJavaScriptBuildConfig?: HasJavaScriptBuildConfigProof;
  hasJavaScriptPackageScripts?: HasJavaScriptPackageScriptsProof;
  hasDockerHeavyWorkflow?: HasDockerHeavyWorkflowProof;
  hasTerraformHeavyWorkflow?: HasTerraformHeavyWorkflowProof;
  hasLargeFiles?: HasLargeFilesProof;
  hasDatadogHeavyWorkflow?: HasDatadogHeavyWorkflowProof;
  hasPytest?: HasPytestProof;
  hasPythonHeavyWorkflow?: HasPythonHeavyWorkflowProof;
  hasRenovateConfig?: HasRenovateConfigProof;
  hasHusky?: HasHuskyProof;
  hasJavaScriptFrameworks?: HasJavaScriptFrameworksProof;
  hasRust?: HasRustProof;
  hasCdkManifest?: HasCdkManifestProof;
  hasElixirHeavyWorkflow?: HasElixirHeavyWorkflowProof;
  hasGradle?: HasGradleProof;
}

export interface HasJavaScriptHeavyWorkflowProof {
  readonly _proof: unique symbol;
}
export interface HasJavaScriptToolingProof {
  readonly _proof: unique symbol;
}
export interface HasJavaScriptLintingProof {
  readonly _proof: unique symbol;
}
export interface HasJavaScriptBuildConfigProof {
  readonly _proof: unique symbol;
}
export interface HasJavaScriptPackageScriptsProof {
  readonly _proof: unique symbol;
}
export interface HasDockerHeavyWorkflowProof {
  readonly _proof: unique symbol;
}
export interface HasTerraformHeavyWorkflowProof {
  readonly _proof: unique symbol;
}
export interface HasLargeFilesProof {
  readonly _proof: unique symbol;
}
export interface HasDatadogHeavyWorkflowProof {
  readonly _proof: unique symbol;
}
export interface HasPytestProof {
  readonly _proof: unique symbol;
}
export interface HasPythonHeavyWorkflowProof {
  readonly _proof: unique symbol;
}
export interface HasRenovateConfigProof {
  readonly _proof: unique symbol;
}
export interface HasHuskyProof {
  readonly _proof: unique symbol;
}
export interface HasJavaScriptFrameworksProof {
  readonly _proof: unique symbol;
}
export interface HasRustProof {
  readonly _proof: unique symbol;
}
export interface HasCdkManifestProof {
  readonly _proof: unique symbol;
}
export interface HasElixirHeavyWorkflowProof {
  readonly _proof: unique symbol;
}
export interface HasGradleProof {
  readonly _proof: unique symbol;
}

export interface RepositoryDiagnosticGateObservability {
  observed: string[];
  derivedFalse: { gate: string; dueTo: string[] }[];
}

export interface RepositoryDiagnosticGateResolution {
  state: RepositoryDiagnosticGateState;
  observability: RepositoryDiagnosticGateObservability;
}

export interface GateProofs {
  hasJavaScriptHeavyWorkflow?: HasJavaScriptHeavyWorkflowProof;
  hasJavaScriptTooling?: HasJavaScriptToolingProof;
  hasJavaScriptLinting?: HasJavaScriptLintingProof;
  hasJavaScriptBuildConfig?: HasJavaScriptBuildConfigProof;
  hasJavaScriptPackageScripts?: HasJavaScriptPackageScriptsProof;
  hasDockerHeavyWorkflow?: HasDockerHeavyWorkflowProof;
  hasTerraformHeavyWorkflow?: HasTerraformHeavyWorkflowProof;
  hasLargeFiles?: HasLargeFilesProof;
  hasDatadogHeavyWorkflow?: HasDatadogHeavyWorkflowProof;
  hasPytest?: HasPytestProof;
  hasPythonHeavyWorkflow?: HasPythonHeavyWorkflowProof;
  hasRenovateConfig?: HasRenovateConfigProof;
  hasHusky?: HasHuskyProof;
  hasJavaScriptFrameworks?: HasJavaScriptFrameworksProof;
  hasRust?: HasRustProof;
  hasCdkManifest?: HasCdkManifestProof;
  hasElixirHeavyWorkflow?: HasElixirHeavyWorkflowProof;
  hasGradle?: HasGradleProof;
}

export interface RepositoryDiagnosticContext {
  repoRoot: string;
  repository: RepositorySignals;
  workflows: WorkflowDocument[];
  workflowSemantics: ReadonlyMap<WorkflowDocument, WorkflowSemantics>;
  warnings: AnalysisWarning[];
  measureCompleteness?: MeasureCompletenessTracker;
  scanContext: RepositoryScanContext;
  fileIndex: RepositoryFileIndex;
  predicateIndex: RepositoryPredicateIndex;
  featureIndex: RepositoryFeatureIndex;
  corpusIndex: RepositoryCorpusIndex;
}

export type GatedContext<_G extends GateKey> = RepositoryDiagnosticContext & {
  proofs: GateProofs;
};

export interface RepositoryDiagnosticCollector<G extends GateKey = GateKey> {
  id: string;
  gate: G;
  collect: (context: GatedContext<G>) => Diagnostic[] | Promise<Diagnostic[]>;
}
