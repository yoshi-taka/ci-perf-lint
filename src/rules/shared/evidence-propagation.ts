import type { Diagnostic, RuleMeta, SourceLocation } from "../../types.ts";
import type { EvidenceStrength } from "./evidence.ts";

export type SemanticScope = "step" | "job" | "workflow";

export interface EvidenceSource {
  readonly location?: SourceLocation;
  readonly workflowPath?: string;
  readonly jobId?: string;
}

export interface SourceWitness {
  readonly scope: SemanticScope;
  readonly label: string;
  readonly strength: EvidenceStrength;
  readonly signals: readonly string[];
  readonly source?: EvidenceSource;
}

export interface EvidenceNode<T> {
  readonly scope: SemanticScope;
  readonly value: T;
  readonly strength: EvidenceStrength;
  readonly label: string;
  readonly signals: readonly string[];
  readonly witnesses: readonly SourceWitness[];
  readonly children: readonly EvidenceNode<unknown>[];
}

export interface EvidenceNodeOptions {
  readonly signals?: string[];
  readonly source?: EvidenceSource;
}

const STRENGTH_PRIORITY: Record<EvidenceStrength, number> = {
  strong: 3,
  medium: 2,
  weak: 1,
};

const SCOPE_PRIORITY: Record<SemanticScope, number> = {
  step: 1,
  job: 2,
  workflow: 3,
};

function maxStrength(a: EvidenceStrength, b: EvidenceStrength): EvidenceStrength {
  return STRENGTH_PRIORITY[a] >= STRENGTH_PRIORITY[b] ? a : b;
}

function maxScope(a: SemanticScope, b: SemanticScope): SemanticScope {
  return SCOPE_PRIORITY[a] >= SCOPE_PRIORITY[b] ? a : b;
}

export function buildStepNode<T>(
  value: T,
  label: string,
  strength: EvidenceStrength,
  opts?: EvidenceNodeOptions,
): EvidenceNode<T> {
  const witness: SourceWitness = {
    scope: "step",
    label,
    strength,
    signals: opts?.signals ?? [],
    source: opts?.source,
  };
  return {
    scope: "step",
    value,
    strength,
    label,
    signals: opts?.signals ?? [],
    witnesses: [witness],
    children: [],
  };
}

export function buildJobNode<T>(
  value: T,
  label: string,
  strength: EvidenceStrength,
  opts?: EvidenceNodeOptions,
): EvidenceNode<T> {
  const witness: SourceWitness = {
    scope: "job",
    label,
    strength,
    signals: opts?.signals ?? [],
    source: opts?.source,
  };
  return {
    scope: "job",
    value,
    strength,
    label,
    signals: opts?.signals ?? [],
    witnesses: [witness],
    children: [],
  };
}

export function buildWorkflowNode<T>(
  value: T,
  label: string,
  strength: EvidenceStrength,
  opts?: EvidenceNodeOptions,
): EvidenceNode<T> {
  const witness: SourceWitness = {
    scope: "workflow",
    label,
    strength,
    signals: opts?.signals ?? [],
    source: opts?.source,
  };
  return {
    scope: "workflow",
    value,
    strength,
    label,
    signals: opts?.signals ?? [],
    witnesses: [witness],
    children: [],
  };
}

export function liftEvidence<T>(
  child: EvidenceNode<T>,
  targetScope: SemanticScope,
  label?: string,
  source?: EvidenceSource,
): EvidenceNode<T> {
  if (child.scope === targetScope) {
    return child;
  }

  const witness: SourceWitness = {
    scope: child.scope,
    label: child.label,
    strength: child.strength,
    signals: child.signals,
    source,
  };

  return {
    scope: targetScope,
    value: child.value,
    strength: child.strength,
    label: label ?? child.label,
    signals: child.signals,
    witnesses: [...child.witnesses, witness],
    children: [child, ...child.children],
  };
}

export function liftStepToJob<T>(
  stepEvidence: EvidenceNode<T>,
  jobId: string,
  label?: string,
  workflowPath?: string,
): EvidenceNode<T> {
  const src = stepEvidence.witnesses[0]?.source;
  const source: EvidenceSource = {
    location: src?.location,
    jobId,
    workflowPath: workflowPath ?? src?.workflowPath,
  };
  return liftEvidence(stepEvidence, "job", label, source);
}

export function liftJobToWorkflow<T>(
  jobEvidence: EvidenceNode<T>,
  workflowPath: string,
  label?: string,
): EvidenceNode<T> {
  const src = jobEvidence.witnesses[0]?.source;
  const source: EvidenceSource = {
    location: src?.location,
    workflowPath,
  };
  return liftEvidence(jobEvidence, "workflow", label, source);
}

function strengthFromNodes(nodes: EvidenceNode<unknown>[]): EvidenceStrength {
  return nodes.reduce<EvidenceStrength>((best, n) => maxStrength(best, n.strength), "weak");
}

export function combineNodes<T>(
  nodes: EvidenceNode<T>[],
  label: string,
  combine: (...values: T[]) => T,
  strengthOverride?: EvidenceStrength,
  source?: EvidenceSource,
): EvidenceNode<T> {
  if (nodes.length === 0) {
    return buildWorkflowNode(undefined as unknown as T, label, "weak", { source });
  }

  const values = nodes.map((n) => n.value);
  const combinedValue = combine(...values);
  const combinedStrength = strengthOverride ?? strengthFromNodes(nodes);
  const allSignals = [...new Set(nodes.flatMap((n) => n.signals))];
  const allWitnesses = nodes.flatMap((n) => n.witnesses);
  const allChildren = nodes.flatMap((n) => [n, ...n.children]);

  const topScope = nodes.reduce<SemanticScope>((best, n) => maxScope(n.scope, best), "step");

  return {
    scope: topScope,
    value: combinedValue,
    strength: combinedStrength,
    label,
    signals: allSignals,
    witnesses: allWitnesses,
    children: allChildren,
  };
}

export function anyNode(
  nodes: EvidenceNode<boolean>[],
  label: string,
  strengthOverride?: EvidenceStrength,
): EvidenceNode<boolean> {
  const relevant = nodes.filter((n) => n.value);
  const effectiveStrength =
    strengthOverride ?? (relevant.length > 0 ? strengthFromNodes(relevant) : "weak");
  return combineNodes(nodes, label, (...values) => values.some(Boolean), effectiveStrength);
}

export function everyNode(
  nodes: EvidenceNode<boolean>[],
  label: string,
  strengthOverride?: EvidenceStrength,
): EvidenceNode<boolean> {
  const effectiveStrength = strengthOverride ?? strengthFromNodes(nodes);
  return combineNodes(nodes, label, (...values) => values.every(Boolean), effectiveStrength);
}

function witnessLocation(w: SourceWitness): string {
  const loc = w.source?.location;
  if (!loc) {
    return "";
  }
  return ` at ${loc.path}:${loc.line}`;
}

function witnessJobRef(w: SourceWitness): string {
  const jobId = w.source?.jobId;
  return jobId ? ` job=${jobId}` : "";
}

export function formatWitnessChain(node: EvidenceNode<unknown>): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  for (const w of node.witnesses) {
    const key = `${w.scope}:${w.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    parts.push(`[${w.scope}] ${w.label} (${w.strength})${witnessLocation(w)}${witnessJobRef(w)}`);
  }

  return parts.join(" → ");
}

export function formatWitnesses(node: EvidenceNode<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const w of node.witnesses) {
    const key = `${w.scope}:${w.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const loc = w.source?.location;
    const location = loc ? ` at ${loc.path}:${loc.line}` : "";
    const jobRef = w.source?.jobId ? ` in job ${w.source.jobId}` : "";
    result.push(`${w.label}${location}${jobRef} (${w.scope}, ${w.strength})`);
  }

  return result;
}

export function evidenceToDiagnostic(
  node: EvidenceNode<boolean>,
  meta: RuleMeta,
  workflowPath: string,
  details: {
    message: string;
    why: string;
    suggestion: string;
    measurementHint: string;
    aiHandoff: string;
    score: number;
  },
): Diagnostic {
  const chain = formatWitnessChain(node);
  const witnessList = formatWitnesses(node);
  const firstLoc = node.witnesses[0]?.source?.location;

  return {
    ruleId: meta.id,
    severity: meta.severity,
    confidence: meta.confidence,
    scope: "workflow",
    docsPath: meta.docsPath,
    workflow: workflowPath,
    location: firstLoc ?? { path: workflowPath, line: 1, column: 1 },
    message: details.message,
    why: `${details.why}\n\nEvidence chain:\n${chain}\n\nLocal witnesses:\n${witnessList.map((w) => `- ${w}`).join("\n")}`,
    suggestion: details.suggestion,
    measurementHint: details.measurementHint,
    aiHandoff: details.aiHandoff,
    score: details.score,
  };
}

export function evidenceNodeStrength(node: EvidenceNode<unknown>): EvidenceStrength {
  return node.strength;
}

export function evidenceNodeLocalWitnesses(node: EvidenceNode<unknown>): readonly SourceWitness[] {
  return node.witnesses;
}

export function evidenceNodeSourceLocations(node: EvidenceNode<unknown>): SourceLocation[] {
  const locations: SourceLocation[] = [];
  const seen = new Set<string>();

  for (const w of node.witnesses) {
    const loc = w.source?.location;
    if (loc) {
      const key = `${loc.path}:${loc.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        locations.push(loc);
      }
    }
  }

  return locations;
}
