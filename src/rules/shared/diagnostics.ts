import type { Node } from "yaml";
import type { Confidence, RuleMeta, Severity, SourceLocation } from "../../types.ts";
import type { ProvenancedDiagnostic, WorkflowDiagnosticSource } from "../../diagnostic-source.ts";
import { getLocation, type WorkflowDocument } from "../../workflow.ts";
import { getPipelineLocation, type PipelineDocument } from "../../buildkite-workflow.ts";
import { getGitlabCiLocation, type GitlabCiDocument } from "../../gitlab-ci-workflow.ts";
import { getCircleCiLocation, type CircleCiDocument } from "../../circleci-workflow.ts";
import {
  reifyDiagnosticFromSource,
  type DiagnosticDetails,
  getDetailTag,
  type LegacyDiagnosticDetails,
  type BlueprintDiagnosticDetails,
  type RepairOp,
} from "../../reification.ts";

type CIWorkflow = WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument;

function isBlueprintDetails(
  details: LegacyDetailsInput | BlueprintDetailsInput,
): details is BlueprintDetailsInput {
  return "repair" in details;
}

function toTaggedDetails(details: LegacyDetailsInput | BlueprintDetailsInput): DiagnosticDetails {
  if (isBlueprintDetails(details)) {
    return {
      _tag: "blueprint",
      message: details.message,
      why: details.why,
      repair: details.repair,
      measurementHint: details.measurementHint,
      score: details.score,
      severity: details.severity,
      confidence: details.confidence,
      location: details.location,
    };
  }
  return {
    _tag: "legacy",
    scope: details.scope,
    message: details.message,
    why: details.why,
    suggestion: details.suggestion,
    measurementHint: details.measurementHint,
    aiHandoff: details.aiHandoff,
    score: details.score,
    severity: details.severity,
    confidence: details.confidence,
    location: details.location,
  };
}

function isGitlabCiDocument(doc: CIWorkflow): doc is GitlabCiDocument {
  return "kind" in doc && doc.kind === "gitlab-ci";
}

function isCircleCiDocument(doc: CIWorkflow): doc is CircleCiDocument {
  return "kind" in doc && doc.kind === "circleci";
}

interface LegacyDetailsInput {
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

interface BlueprintDetailsInput {
  message: string;
  why: string;
  repair: RepairOp;
  measurementHint: string;
  score: number;
  severity?: Severity;
  confidence?: Confidence;
  location?: SourceLocation;
}

export function buildDiagnostic(
  workflow: CIWorkflow,
  meta: RuleMeta,
  node: Node | undefined,
  details: LegacyDetailsInput | BlueprintDetailsInput,
): ProvenancedDiagnostic<WorkflowDiagnosticSource> {
  const taggedDetails = toTaggedDetails(details);
  const isPipeline = "steps" in workflow && !("jobs" in workflow);
  const isGitlab = isGitlabCiDocument(workflow);
  const isCircle = isCircleCiDocument(workflow);
  const docLocation = isPipeline
    ? getPipelineLocation(workflow, node)
    : isGitlab
      ? getGitlabCiLocation(workflow, node)
      : isCircle
        ? getCircleCiLocation(workflow, node)
        : getLocation(workflow, node);

  if (getDetailTag(taggedDetails) === "blueprint") {
    const blueprintDetails = taggedDetails as BlueprintDiagnosticDetails;
    return reifyDiagnosticFromSource(
      meta,
      {
        kind: "workflow",
        workflowPath: workflow.relativePath,
        location: docLocation,
      },
      node,
      {
        message: blueprintDetails.message,
        why: blueprintDetails.why,
        repair: blueprintDetails.repair,
        measurementHint: blueprintDetails.measurementHint,
        score: blueprintDetails.score,
      },
      {
        severity: blueprintDetails.severity,
        confidence: blueprintDetails.confidence,
        location: blueprintDetails.location ?? docLocation,
      },
    );
  }

  const legacyDetails = taggedDetails as LegacyDiagnosticDetails;
  const severity = legacyDetails.severity ?? meta.severity;
  const confidence = legacyDetails.confidence ?? meta.confidence;
  const source: WorkflowDiagnosticSource = {
    kind: "workflow",
    workflowPath: workflow.relativePath,
    location: docLocation,
  };
  return reifyDiagnosticFromSource(
    meta,
    source,
    node,
    {
      scope: legacyDetails.scope,
      message: legacyDetails.message,
      why: legacyDetails.why,
      suggestion: legacyDetails.suggestion,
      measurementHint: legacyDetails.measurementHint,
      aiHandoff: legacyDetails.aiHandoff,
      score: legacyDetails.score,
      severity: legacyDetails.severity,
      confidence: legacyDetails.confidence,
      location: legacyDetails.location,
    },
    {
      severity,
      confidence,
      location: legacyDetails.location,
    },
  );
}
