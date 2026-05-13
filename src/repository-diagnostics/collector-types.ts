import type { AnalysisWarning, Diagnostic, MeasureCompletenessTracker } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowSemantics } from "../rules/shared/workflow-semantics.ts";
import type { RepositoryFileIndex } from "../rules/shared/repository-file-index.ts";
import type { RepositoryPredicateIndex } from "../rules/shared/repository-predicate-index.ts";
import type { RepositoryFeatureIndex } from "./repository-feature-index.ts";
import type { RepositoryCorpusIndex } from "../rules/shared/repository-corpus-index.ts";
import type { GateExpr } from "./gate-expr.ts";
import { evaluateGateExpr } from "./gate-expr.ts";
import type { ResourceGetter } from "./semantic-resource.ts";

const GATE_DEFINITIONS = {
  hasJavaScriptHeavyWorkflow: {},
  hasJavaScriptTooling: {},
  hasJavaScriptLinting: {},
  hasJavaScriptBuildConfig: {},
  hasJavaScriptPackageScripts: {},
  hasDockerHeavyWorkflow: {},
  hasTerraformHeavyWorkflow: {},
  hasLargeFiles: {},
  hasDatadogHeavyWorkflow: {},
  hasPytest: {},
  hasPythonHeavyWorkflow: {},
  hasRenovateConfig: {},
  hasHusky: {},
  hasJavaScriptFrameworks: {},
  hasRust: {},
  hasCdkManifest: {},
  hasElixirHeavyWorkflow: {},
  hasGradle: {},
} as const satisfies Record<string, object>;

export type GateKey = keyof typeof GATE_DEFINITIONS;

export type GateResult =
  | { readonly status: "resolved"; readonly value: boolean }
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "error"; readonly reason: string };

export type GateResultRecord = Record<GateKey, GateResult>;

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

type _GateStateExhaustiveCheck = keyof RepositoryDiagnosticGateState extends GateKey
  ? GateKey extends keyof RepositoryDiagnosticGateState
    ? true
    : never
  : never;

export type ProofForGate<G extends GateKey> = { readonly __gate: G };

export type GateTrue<G extends GateKey> = {
  readonly __gate: G;
  readonly __proof: ProofForGate<G>;
};

export type GateProofs = { [K in GateKey]?: ProofForGate<K> };

export type GatedContext<G extends GateKey> = RepositoryDiagnosticContext & {
  readonly __typedGate: GateTrue<G>;
};

export type MultiGatedContext<Gs extends readonly GateKey[]> = RepositoryDiagnosticContext & {
  readonly __gatesProven: true;
  readonly __gateKeys: Gs;
};

export interface RepositoryDiagnosticGateObservability {
  observed: string[];
  derivedFalse: { gate: string; dueTo: string[] }[];
}

export interface RepositoryDiagnosticGateResolution {
  state: RepositoryDiagnosticGateState;
  observability: RepositoryDiagnosticGateObservability;
  results: GateResultRecord;
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
  getResource?: ResourceGetter;
}

export type CollectorContext<G extends GateKey, Gs extends readonly GateKey[]> = Gs extends never[]
  ? GatedContext<G>
  : MultiGatedContext<Gs>;

export interface RepositoryDiagnosticCollector<
  G extends GateKey = GateKey,
  Gs extends readonly GateKey[] = never[],
> {
  id: string;
  gate?: G;
  gates?: Gs;
  gateExpr?: GateExpr<GateKey>;
  collect: (context: CollectorContext<G, Gs>) => Diagnostic[] | Promise<Diagnostic[]>;
}

function checkLegacyGate(
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

function collectorRequiresAllGates(
  collector: { gate?: GateKey; gates?: readonly GateKey[]; gateExpr?: GateExpr<GateKey> },
  gateState: RepositoryDiagnosticGateState,
): boolean {
  if (collector.gateExpr) {
    return evaluateGateExpr(collector.gateExpr, gateState);
  }
  return checkLegacyGate(collector, gateState);
}

function gateResultFromRecord(key: GateKey, results: GateResultRecord): GateResult {
  return results[key];
}

export function collectorRequiresAllGatesFromResults(
  collector: { gate?: GateKey; gates?: readonly GateKey[]; gateExpr?: GateExpr<GateKey> },
  results: GateResultRecord,
): GateResult {
  if (collector.gateExpr) {
    return evaluateGateExprWithResult(collector.gateExpr, results);
  }

  const keys: GateKey[] = [];
  if (collector.gates && collector.gates.length > 0) {
    keys.push(...collector.gates);
  } else if (collector.gate) {
    keys.push(collector.gate);
  }

  if (keys.length === 0) {
    return { status: "resolved", value: true };
  }

  for (const key of keys) {
    const r = gateResultFromRecord(key, results);
    if (r.status === "error") {
      return r;
    }
    if (r.status === "skipped") {
      return r;
    }
    if (!r.value) {
      return { status: "resolved", value: false };
    }
  }
  return { status: "resolved", value: true };
}

function evaluateGateExprWithResult(
  expr: GateExpr<GateKey>,
  results: GateResultRecord,
): GateResult {
  switch (expr.kind) {
    case "atom": {
      return gateResultFromRecord(expr.gate, results);
    }
    case "and": {
      const left = evaluateGateExprWithResult(expr.left, results);
      if (left.status !== "resolved") {
        return left;
      }
      if (!left.value) {
        return { status: "resolved", value: false };
      }
      return evaluateGateExprWithResult(expr.right, results);
    }
    case "or": {
      const left = evaluateGateExprWithResult(expr.left, results);
      if (left.status !== "resolved") {
        return left;
      }
      if (left.value) {
        return { status: "resolved", value: true };
      }
      return evaluateGateExprWithResult(expr.right, results);
    }
    case "not": {
      const inner = evaluateGateExprWithResult(expr.inner, results);
      if (inner.status !== "resolved") {
        return inner;
      }
      return { status: "resolved", value: !inner.value };
    }
  }
}

export function buildTypedContext<G extends GateKey>(
  context: RepositoryDiagnosticContext,
  gate: G,
  proof: ProofForGate<G>,
): GatedContext<G> {
  return {
    ...context,
    __typedGate: { __gate: gate, __proof: proof },
  } as GatedContext<G>;
}

export function assertGateProof<G extends GateKey>(gate: G, proofs: GateProofs): GateTrue<G> {
  const proof = proofs[gate];
  if (!proof) {
    throw new Error(`Gate "${gate}" is false. Cannot create proof for unproven gate.`);
  }
  return { __gate: gate, __proof: proof };
}
