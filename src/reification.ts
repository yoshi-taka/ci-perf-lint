import type { Node } from "yaml";
import type { Confidence, RuleMeta, Severity, SourceLocation } from "./types.ts";
import {
  composeDiagnosticSources,
  diagnosticSourceToRef,
  type ProvenancedDiagnostic,
  type DiagnosticSource,
  type DiagnosticSourceRef,
  type RepositoryDiagnosticSource,
  type WorkflowDiagnosticSource,
} from "./diagnostic-source.ts";

// ──────────────────────────────────────────────
// 1. SOURCE REFERENCE — structured locality
// ──────────────────────────────────────────────

type SourceRef = DiagnosticSourceRef;

function formatWorkflowPath(path: string): string {
  return `\`${path}\``;
}

function formatSourceRef(ref: SourceRef): string {
  if (ref.kind === "composite" && ref.sources) {
    const composite = composeDiagnosticSources(
      ...(ref.sources as unknown as [DiagnosticSource, ...DiagnosticSource[]]),
    );
    return composite.sources.map(formatSourceRef).join(" and ");
  }

  if (ref.kind === "repository") {
    return ref.workflowPath
      ? `repository via ${formatWorkflowPath(ref.workflowPath)}`
      : "repository";
  }

  if (ref.kind === "workflow" && ref.workflowPath) {
    return formatWorkflowPath(ref.workflowPath);
  }

  return ref.workflowPath ? formatWorkflowPath(ref.workflowPath) : "";
}

// ──────────────────────────────────────────────
// 2. REPAIR INSTRUCTION — structured ops
// ──────────────────────────────────────────────

export type RepairAction = "add" | "remove" | "modify" | "replace" | "review";
export type RepairScope = "workflow" | "job" | "step" | "configuration";

export interface RepairOp {
  action: RepairAction;
  scope: RepairScope;
  target: string;
  value?: string;
  detail?: string;
}

function renderSuggestion(op: RepairOp): string {
  const prefix =
    op.action === "review"
      ? "Review"
      : op.action === "add"
        ? "Add"
        : op.action === "remove"
          ? "Remove"
          : op.action === "modify"
            ? "Modify"
            : "Replace";

  const scopeText =
    op.scope === "workflow"
      ? "the workflow"
      : op.scope === "job"
        ? "the job"
        : op.scope === "step"
          ? "the step"
          : "the configuration";

  if (op.action === "add" && op.value) {
    return `${prefix} \`${op.target}\` to ${scopeText} with an appropriate value (e.g., ${op.value}).`;
  }
  if (op.action === "add") {
    return `${prefix} \`${op.target}\` to ${scopeText}.`;
  }
  if (op.action === "remove" && op.target) {
    return `${prefix} \`${op.target}\` from ${scopeText}.`;
  }
  if (op.action === "modify" && op.value) {
    return `${prefix} \`${op.target}\` in ${scopeText} (e.g., ${op.value}).`;
  }
  if (op.detail) {
    return `${prefix} ${op.detail} in ${scopeText}.`;
  }
  return `${prefix} ${op.target} in ${scopeText}.`;
}

export function renderAiHandoff(
  op: RepairOp,
  ruleId: string,
  source?: DiagnosticSource | SourceRef,
): string {
  const sourceStr = source ? formatSourceRef(source as SourceRef) : "";
  const prefix = sourceStr ? `Review ${sourceStr} for ${ruleId}.` : `Review for ${ruleId}.`;

  if (op.action === "review") {
    return `${prefix} ${op.detail ?? "Assess whether changes are needed."}`;
  }

  const scopeText =
    op.scope === "workflow"
      ? "the workflow"
      : op.scope === "job"
        ? "the job"
        : op.scope === "step"
          ? "the step"
          : "the configuration";

  if (op.action === "add" && op.value) {
    return `${prefix} Consider adding ${op.scope === "workflow" ? "a" : "an"} \`${op.target}\` to ${scopeText}. For example:\n\n${op.value}`;
  }
  if (op.action === "add") {
    return `${prefix} Consider adding \`${op.target}\` to ${scopeText}.`;
  }
  if (op.action === "remove") {
    return `${prefix} Consider removing \`${op.target}\` from ${scopeText}.`;
  }
  if (op.action === "modify" && op.value) {
    return `${prefix} Consider updating \`${op.target}\` in ${scopeText} (e.g., ${op.value}).`;
  }
  return `${prefix} ${op.detail ?? "Apply the suggested change."}`;
}

// ──────────────────────────────────────────────
// 3. DIAGNOSTIC BLUEPRINT — structured finding
// ──────────────────────────────────────────────

export interface DiagnosticBlueprint {
  message: string;
  why: string;
  repair: RepairOp;
  measurementHint: string;
  score: number;
}

// ──────────────────────────────────────────────
// 3a. TAGGED DIAGNOSTIC DETAILS — explicit variants
// ──────────────────────────────────────────────

type DetailTag = "legacy" | "blueprint";

export interface LegacyDiagnosticDetails {
  readonly _tag: "legacy";
  readonly scope?: "workflow" | "repository";
  readonly message: string;
  readonly why: string;
  readonly suggestion: string;
  readonly measurementHint: string;
  readonly aiHandoff: string;
  readonly score: number;
  readonly severity?: Severity;
  readonly confidence?: Confidence;
  readonly location?: SourceLocation;
}

export interface BlueprintDiagnosticDetails {
  readonly _tag: "blueprint";
  readonly message: string;
  readonly why: string;
  readonly repair: RepairOp;
  readonly measurementHint: string;
  readonly score: number;
  readonly severity?: Severity;
  readonly confidence?: Confidence;
  readonly location?: SourceLocation;
}

export type DiagnosticDetails = LegacyDiagnosticDetails | BlueprintDiagnosticDetails;

export function createLegacyDetails(
  // fallow-ignore unused-exports
  details: Omit<LegacyDiagnosticDetails, "_tag">,
): LegacyDiagnosticDetails {
  return { _tag: "legacy", ...details };
}

export function createBlueprintDetails(
  // fallow-ignore unused-exports
  details: Omit<BlueprintDiagnosticDetails, "_tag">,
): BlueprintDiagnosticDetails {
  return { _tag: "blueprint", ...details };
}

type DiagnosticDetailsVisitor<R> = {
  onLegacy: (details: LegacyDiagnosticDetails) => R;
  onBlueprint: (details: BlueprintDiagnosticDetails) => R;
};

export function foldDiagnosticDetails<R>(
  // fallow-ignore unused-exports
  details: DiagnosticDetails,
  visitor: DiagnosticDetailsVisitor<R>,
): R {
  switch (details._tag) {
    case "legacy":
      return visitor.onLegacy(details);
    case "blueprint":
      return visitor.onBlueprint(details);
  }
}

export function getDetailTag(details: DiagnosticDetails): DetailTag {
  return details._tag;
}

interface LegacyWorkflowDiagnosticDetails {
  scope?: "workflow" | "repository";
  message: string;
  why: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: string;
  score: number;
  severity?: Severity;
  confidence?: Confidence;
  location?: SourceLocation;
}

interface LegacyRepositoryDiagnosticDetails {
  message: string;
  why: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: string;
  score: number;
  location: SourceLocation;
  severity?: Severity;
  confidence?: Confidence;
}

function resolveWorkflowSourceLocation(
  source: WorkflowDiagnosticSource,
  _node: Node | undefined,
): SourceLocation {
  return source.location;
}

function resolveRepositorySourceLocation(source: RepositoryDiagnosticSource): SourceLocation {
  return source.location;
}

// ──────────────────────────────────────────────
// 4. MAIN REIFICATION ENTRY POINTS
// ──────────────────────────────────────────────

export function reifyDiagnosticFromSource(
  meta: RuleMeta,
  source: WorkflowDiagnosticSource,
  node: Node | undefined,
  details: LegacyWorkflowDiagnosticDetails | DiagnosticBlueprint,
  overrides?: {
    severity?: Severity;
    confidence?: Confidence;
    location?: SourceLocation;
  },
): ProvenancedDiagnostic<WorkflowDiagnosticSource> {
  const severity = overrides?.severity ?? meta.severity;
  const confidence = overrides?.confidence ?? meta.confidence;
  const docLocation = overrides?.location ?? resolveWorkflowSourceLocation(source, node);
  const sourceRef = diagnosticSourceToRef(source);

  if ("repair" in details) {
    return {
      ruleId: meta.id,
      severity,
      confidence,
      docsPath: meta.docsPath,
      workflow: source.workflowPath,
      location: docLocation,
      message: details.message,
      why: details.why,
      suggestion: renderSuggestion(details.repair),
      measurementHint: details.measurementHint,
      aiHandoff: renderAiHandoff(details.repair, meta.id, sourceRef),
      score: details.score,
      repair: details.repair,
      source,
    };
  }

  return {
    ruleId: meta.id,
    severity,
    confidence,
    docsPath: meta.docsPath,
    workflow: source.workflowPath,
    location: docLocation,
    message: details.message,
    why: details.why,
    suggestion: details.suggestion,
    measurementHint: details.measurementHint,
    aiHandoff: details.aiHandoff,
    score: details.score,
    source,
  };
}

export function reifyRepositoryDiagnosticFromSource(
  meta: RuleMeta,
  source: RepositoryDiagnosticSource,
  details: LegacyRepositoryDiagnosticDetails | DiagnosticBlueprint,
  overrides?: {
    severity?: Severity;
    confidence?: Confidence;
  },
): ProvenancedDiagnostic<RepositoryDiagnosticSource> {
  const severity = overrides?.severity ?? meta.severity;
  const confidence = overrides?.confidence ?? meta.confidence;
  const sourceRef = diagnosticSourceToRef(source);

  if ("repair" in details) {
    return {
      ruleId: meta.id,
      severity,
      confidence,
      scope: "repository",
      docsPath: meta.docsPath,
      workflow: source.workflowPath,
      location: resolveRepositorySourceLocation(source),
      message: details.message,
      why: details.why,
      suggestion: renderSuggestion(details.repair),
      measurementHint: details.measurementHint,
      aiHandoff: renderAiHandoff(details.repair, meta.id, sourceRef),
      score: details.score,
      repair: details.repair,
      source,
    };
  }

  return {
    ruleId: meta.id,
    severity,
    confidence,
    scope: "repository",
    docsPath: meta.docsPath,
    workflow: source.workflowPath,
    location: resolveRepositorySourceLocation(source),
    message: details.message,
    why: details.why,
    suggestion: details.suggestion,
    measurementHint: details.measurementHint,
    aiHandoff: details.aiHandoff,
    score: details.score,
    source,
  };
}
