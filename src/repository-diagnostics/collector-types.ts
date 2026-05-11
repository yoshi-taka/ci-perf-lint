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

declare const __hasJavaScriptHeavyWorkflowProof: unique symbol;
declare const __hasJavaScriptToolingProof: unique symbol;
declare const __hasJavaScriptLintingProof: unique symbol;
declare const __hasJavaScriptBuildConfigProof: unique symbol;
declare const __hasJavaScriptPackageScriptsProof: unique symbol;
declare const __hasDockerHeavyWorkflowProof: unique symbol;
declare const __hasTerraformHeavyWorkflowProof: unique symbol;
declare const __hasLargeFilesProof: unique symbol;
declare const __hasDatadogHeavyWorkflowProof: unique symbol;
declare const __hasPytestProof: unique symbol;
declare const __hasPythonHeavyWorkflowProof: unique symbol;
declare const __hasRenovateConfigProof: unique symbol;
declare const __hasHuskyProof: unique symbol;
declare const __hasJavaScriptFrameworksProof: unique symbol;
declare const __hasRustProof: unique symbol;
declare const __hasCdkManifestProof: unique symbol;
declare const __hasElixirHeavyWorkflowProof: unique symbol;
declare const __hasGradleProof: unique symbol;

export interface HasJavaScriptHeavyWorkflowProof {
  readonly __proof: typeof __hasJavaScriptHeavyWorkflowProof;
}
export interface HasJavaScriptToolingProof {
  readonly __proof: typeof __hasJavaScriptToolingProof;
}
export interface HasJavaScriptLintingProof {
  readonly __proof: typeof __hasJavaScriptLintingProof;
}
export interface HasJavaScriptBuildConfigProof {
  readonly __proof: typeof __hasJavaScriptBuildConfigProof;
}
export interface HasJavaScriptPackageScriptsProof {
  readonly __proof: typeof __hasJavaScriptPackageScriptsProof;
}
export interface HasDockerHeavyWorkflowProof {
  readonly __proof: typeof __hasDockerHeavyWorkflowProof;
}
export interface HasTerraformHeavyWorkflowProof {
  readonly __proof: typeof __hasTerraformHeavyWorkflowProof;
}
export interface HasLargeFilesProof {
  readonly __proof: typeof __hasLargeFilesProof;
}
export interface HasDatadogHeavyWorkflowProof {
  readonly __proof: typeof __hasDatadogHeavyWorkflowProof;
}
export interface HasPytestProof {
  readonly __proof: typeof __hasPytestProof;
}
export interface HasPythonHeavyWorkflowProof {
  readonly __proof: typeof __hasPythonHeavyWorkflowProof;
}
export interface HasRenovateConfigProof {
  readonly __proof: typeof __hasRenovateConfigProof;
}
export interface HasHuskyProof {
  readonly __proof: typeof __hasHuskyProof;
}
export interface HasJavaScriptFrameworksProof {
  readonly __proof: typeof __hasJavaScriptFrameworksProof;
}
export interface HasRustProof {
  readonly __proof: typeof __hasRustProof;
}
export interface HasCdkManifestProof {
  readonly __proof: typeof __hasCdkManifestProof;
}
export interface HasElixirHeavyWorkflowProof {
  readonly __proof: typeof __hasElixirHeavyWorkflowProof;
}
export interface HasGradleProof {
  readonly __proof: typeof __hasGradleProof;
}

export type ProofForGate<G extends GateKey> = G extends "hasJavaScriptHeavyWorkflow"
  ? HasJavaScriptHeavyWorkflowProof
  : G extends "hasJavaScriptTooling"
    ? HasJavaScriptToolingProof
    : G extends "hasJavaScriptLinting"
      ? HasJavaScriptLintingProof
      : G extends "hasJavaScriptBuildConfig"
        ? HasJavaScriptBuildConfigProof
        : G extends "hasJavaScriptPackageScripts"
          ? HasJavaScriptPackageScriptsProof
          : G extends "hasDockerHeavyWorkflow"
            ? HasDockerHeavyWorkflowProof
            : G extends "hasTerraformHeavyWorkflow"
              ? HasTerraformHeavyWorkflowProof
              : G extends "hasLargeFiles"
                ? HasLargeFilesProof
                : G extends "hasDatadogHeavyWorkflow"
                  ? HasDatadogHeavyWorkflowProof
                  : G extends "hasPytest"
                    ? HasPytestProof
                    : G extends "hasPythonHeavyWorkflow"
                      ? HasPythonHeavyWorkflowProof
                      : G extends "hasRenovateConfig"
                        ? HasRenovateConfigProof
                        : G extends "hasHusky"
                          ? HasHuskyProof
                          : G extends "hasJavaScriptFrameworks"
                            ? HasJavaScriptFrameworksProof
                            : G extends "hasRust"
                              ? HasRustProof
                              : G extends "hasCdkManifest"
                                ? HasCdkManifestProof
                                : G extends "hasElixirHeavyWorkflow"
                                  ? HasElixirHeavyWorkflowProof
                                  : G extends "hasGradle"
                                    ? HasGradleProof
                                    : never;

export type GateTrue<G extends GateKey> = {
  readonly __gate: G;
  readonly __proof: ProofForGate<G>;
};

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

export type GatedContext<G extends GateKey> = RepositoryDiagnosticContext & {
  readonly __typedGate: GateTrue<G>;
};

export interface RepositoryDiagnosticGateObservability {
  observed: string[];
  derivedFalse: { gate: string; dueTo: string[] }[];
}

export interface RepositoryDiagnosticGateResolution {
  state: RepositoryDiagnosticGateState;
  observability: RepositoryDiagnosticGateObservability;
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

export interface RepositoryDiagnosticCollector<G extends GateKey = GateKey> {
  id: string;
  gate?: G;
  gates?: readonly GateKey[];
  collect: (context: GatedContext<G>) => Diagnostic[] | Promise<Diagnostic[]>;
}

export function collectorRequiresAllGates(
  collector: { gate?: GateKey; gates?: readonly GateKey[] },
  gateState: RepositoryDiagnosticGateState,
): boolean {
  const checkGate = (g: GateKey): boolean => gateState[g];
  if (collector.gates) {
    return collector.gates.every(checkGate);
  }
  if (collector.gate) {
    return checkGate(collector.gate);
  }
  return true;
}

function __unsafeWrapProof<G extends GateKey>(_gate: G, _proof: ProofForGate<G>): GateTrue<G> {
  return {
    __gate: _gate,
    __proof: _proof,
  } as GateTrue<G>;
}

function buildTypedContext<G extends GateKey>(
  context: RepositoryDiagnosticContext,
  gate: G,
  proof: ProofForGate<G>,
): GatedContext<G> {
  return {
    ...context,
    __typedGate: __unsafeWrapProof(gate, proof),
  } as GatedContext<G>;
}

export function assertGateProof<G extends GateKey>(gate: G, proofs: GateProofs): GateTrue<G> {
  const key = gate as keyof GateProofs;
  const proof = proofs[key];
  if (!proof) {
    throw new Error(`Gate "${gate}" is false. Cannot create proof for unproven gate.`);
  }
  return __unsafeWrapProof(gate, proof as ProofForGate<G>);
}
