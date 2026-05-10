import type { Node } from "yaml";
import type { Confidence, Diagnostic, RuleMeta, Severity, SourceLocation } from "./types.ts";
import type { RepositorySignals } from "./repository-signals-types.ts";
import { getLocation, type WorkflowDocument } from "./workflow.ts";
import { getPipelineLocation, type PipelineDocument } from "./buildkite-workflow.ts";
import { getGitlabCiLocation, type GitlabCiDocument } from "./gitlab-ci-workflow.ts";
import { getCircleCiLocation, type CircleCiDocument } from "./circleci-workflow.ts";

type CIWorkflow = WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument;

// ──────────────────────────────────────────────
// 1. SOURCE REFERENCE — structured locality
// ──────────────────────────────────────────────

interface SourceRef {
  workflowPath: string;
  jobId?: string;
  stepIndex?: number;
}

function formatWorkflowPath(path: string): string {
  return `\`${path}\``;
}

function formatJobRef(id: string): string {
  return `"${id}"`;
}

function formatWorkflowJobRef(workflowPath: string, jobId: string): string {
  return `${formatWorkflowPath(workflowPath)} job ${formatJobRef(jobId)}`;
}

function formatSourceRef(ref: SourceRef): string {
  if (ref.jobId) {
    return formatWorkflowJobRef(ref.workflowPath, ref.jobId);
  }
  return formatWorkflowPath(ref.workflowPath);
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

function renderAiHandoff(op: RepairOp, ruleId: string, source?: SourceRef): string {
  const sourceStr = source ? formatSourceRef(source) : "";
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

function isGitlabCiDocument(doc: CIWorkflow): doc is GitlabCiDocument {
  return "kind" in doc && doc.kind === "gitlab-ci";
}

function isCircleCiDocument(doc: CIWorkflow): doc is CircleCiDocument {
  return "kind" in doc && doc.kind === "circleci";
}

function resolveDiagnosticLocation(workflow: CIWorkflow, node: Node | undefined): SourceLocation {
  const isPipeline = "steps" in workflow && !("jobs" in workflow);
  const isGitlab = isGitlabCiDocument(workflow);
  const isCircle = isCircleCiDocument(workflow);
  return isPipeline
    ? getPipelineLocation(workflow, node)
    : isGitlab
      ? getGitlabCiLocation(workflow, node)
      : isCircle
        ? getCircleCiLocation(workflow, node)
        : getLocation(workflow, node);
}

// ──────────────────────────────────────────────
// 5. MAIN REIFICATION ENTRY POINTS
// ──────────────────────────────────────────────

export function reifyDiagnostic(
  meta: RuleMeta,
  workflow: CIWorkflow,
  node: Node | undefined,
  blueprint: DiagnosticBlueprint,
  overrides?: {
    severity?: Severity;
    confidence?: Confidence;
    location?: SourceLocation;
  },
): Diagnostic {
  const severity = overrides?.severity ?? meta.severity;
  const confidence = overrides?.confidence ?? meta.confidence;
  const docLocation = overrides?.location ?? resolveDiagnosticLocation(workflow, node);
  const sourceRef: SourceRef = { workflowPath: workflow.relativePath };

  return {
    ruleId: meta.id,
    severity,
    confidence,
    docsPath: meta.docsPath,
    workflow: workflow.relativePath,
    location: docLocation,
    message: blueprint.message,
    why: blueprint.why,
    suggestion: renderSuggestion(blueprint.repair),
    measurementHint: blueprint.measurementHint,
    aiHandoff: renderAiHandoff(blueprint.repair, meta.id, sourceRef),
    score: blueprint.score,
  };
}

export function reifyRepositoryDiagnostic(
  repository: RepositorySignals,
  meta: RuleMeta,
  blueprint: DiagnosticBlueprint,
  location: SourceLocation,
  overrides?: {
    severity?: Severity;
    confidence?: Confidence;
  },
): Diagnostic {
  const severity = overrides?.severity ?? meta.severity;
  const confidence = overrides?.confidence ?? meta.confidence;
  const fallbackPath = ".github/workflows/ci.yml";
  const wfPath = repository.primaryWorkflowPath ?? fallbackPath;
  const sourceRef: SourceRef = { workflowPath: wfPath };

  return {
    ruleId: meta.id,
    severity,
    confidence,
    scope: "repository",
    docsPath: meta.docsPath,
    workflow: wfPath,
    location,
    message: blueprint.message,
    why: blueprint.why,
    suggestion: renderSuggestion(blueprint.repair),
    measurementHint: blueprint.measurementHint,
    aiHandoff: renderAiHandoff(blueprint.repair, meta.id, sourceRef),
    score: blueprint.score,
  };
}
