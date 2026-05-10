import type { Confidence, Diagnostic, RuleMeta, Severity, SourceLocation } from "../../types.ts";

export type SemanticCategory =
  | "performance"
  | "reliability"
  | "security"
  | "correctness"
  | "maintainability";

export type SheetType = "workflow" | "repository" | "aggregated";

export interface FindingCore {
  readonly ruleId: string;
  readonly ruleMeta: RuleMeta;
  readonly evidence: readonly string[];
  readonly rootCause: string;
  readonly category: SemanticCategory;
  readonly locations: readonly SourceLocation[];
  readonly workflowPaths: readonly string[];
  readonly docsPath: string;
}

export interface WorkflowSheet {
  readonly type: "workflow";
  readonly workflow: string;
  readonly location: SourceLocation;
  readonly score: number;
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly message: string;
  readonly why: string;
  readonly suggestion: string;
  readonly measurementHint: string;
  readonly aiHandoff: string;
}

export interface RepositorySheet {
  readonly type: "repository";
  readonly primaryWorkflow: string;
  readonly location: SourceLocation;
  readonly score: number;
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly message: string;
  readonly why: string;
  readonly suggestion: string;
  readonly measurementHint: string;
  readonly aiHandoff: string;
}

export type Sheet = WorkflowSheet | RepositorySheet;

export interface SheetDiagnostic {
  readonly core: FindingCore;
  readonly sheet: Sheet;
}

const REPOSITORY_SCORE_PENALTY = 5;
const REPOSITORY_SEVERITY_BUMP: Record<Severity, Severity> = {
  error: "error",
  warning: "error",
  suggestion: "warning",
};

function defaultSheetSeverity(meta: RuleMeta, targetSheet: SheetType): Severity {
  if (targetSheet === "repository") {
    return REPOSITORY_SEVERITY_BUMP[meta.severity];
  }
  return meta.severity;
}

function defaultSheetScore(score: number, targetSheet: SheetType): number {
  if (targetSheet === "repository") {
    return Math.min(100, score + REPOSITORY_SCORE_PENALTY);
  }
  return score;
}

export function buildFindingCore(
  ruleMeta: RuleMeta,
  details: {
    evidence: string[];
    rootCause: string;
    category: SemanticCategory;
    location: SourceLocation;
    workflowPath?: string;
  },
): FindingCore {
  return {
    ruleId: ruleMeta.id,
    ruleMeta,
    evidence: details.evidence,
    rootCause: details.rootCause,
    category: details.category,
    locations: [details.location],
    workflowPaths: details.workflowPath ? [details.workflowPath] : [],
    docsPath: ruleMeta.docsPath,
  };
}

export function projectToWorkflowSheet(
  core: FindingCore,
  details: {
    workflow: string;
    message: string;
    why: string;
    suggestion: string;
    measurementHint: string;
    aiHandoff: string;
    score: number;
    location?: SourceLocation;
    severity?: Severity;
    confidence?: Confidence;
  },
): WorkflowSheet {
  const severity = details.severity ?? core.ruleMeta.severity;
  const confidence = details.confidence ?? core.ruleMeta.confidence;
  return {
    type: "workflow",
    workflow: details.workflow,
    location: details.location ??
      core.locations[0] ?? { path: details.workflow, line: 1, column: 1 },
    score: defaultSheetScore(details.score, "workflow"),
    severity,
    confidence,
    message: details.message,
    why: details.why,
    suggestion: details.suggestion,
    measurementHint: details.measurementHint,
    aiHandoff: details.aiHandoff,
  };
}

export function projectToRepositorySheet(
  core: FindingCore,
  details: {
    primaryWorkflow: string;
    message: string;
    why: string;
    suggestion: string;
    measurementHint: string;
    aiHandoff: string;
    score: number;
    location: SourceLocation;
    severity?: Severity;
    confidence?: Confidence;
  },
): RepositorySheet {
  const severity = details.severity ?? defaultSheetSeverity(core.ruleMeta, "repository");
  const confidence = details.confidence ?? core.ruleMeta.confidence;
  return {
    type: "repository",
    primaryWorkflow: details.primaryWorkflow,
    location: details.location,
    score: defaultSheetScore(details.score, "repository"),
    severity,
    confidence,
    message: details.message,
    why: details.why,
    suggestion: details.suggestion,
    measurementHint: details.measurementHint,
    aiHandoff: details.aiHandoff,
  };
}

export function sheetDiagnosticToDiagnostic(sd: SheetDiagnostic): Diagnostic {
  const sheet = sd.sheet;
  return {
    ruleId: sd.core.ruleId,
    severity: sheet.severity,
    confidence: sheet.confidence,
    scope: sheet.type === "repository" ? "repository" : "workflow",
    docsPath: sd.core.docsPath,
    workflow: sheet.type === "repository" ? sheet.primaryWorkflow : sheet.workflow,
    location: sheet.location,
    message: sheet.message,
    why: sheet.why,
    suggestion: sheet.suggestion,
    measurementHint: sheet.measurementHint,
    aiHandoff: sheet.aiHandoff,
    score: sheet.score,
  };
}

export function sheetDiagnosticsToDiagnostics(sds: SheetDiagnostic[]): Diagnostic[] {
  return sds.map(sheetDiagnosticToDiagnostic);
}

export function sheetType(sd: SheetDiagnostic): SheetType {
  return sd.sheet.type;
}

export function isWorkflowSheet(
  sd: SheetDiagnostic,
): sd is SheetDiagnostic & { sheet: WorkflowSheet } {
  return sd.sheet.type === "workflow";
}

export function isRepositorySheet(
  sd: SheetDiagnostic,
): sd is SheetDiagnostic & { sheet: RepositorySheet } {
  return sd.sheet.type === "repository";
}

export function sheetWorkflowPath(sd: SheetDiagnostic): string {
  return sd.sheet.type === "workflow" ? sd.sheet.workflow : sd.sheet.primaryWorkflow;
}
