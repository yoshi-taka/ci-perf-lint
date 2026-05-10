import type { Node } from "yaml";
import type { Confidence, Diagnostic, RuleMeta, Severity, SourceLocation } from "../../types.ts";
import { getLocation, type WorkflowDocument } from "../../workflow.ts";
import { getPipelineLocation, type PipelineDocument } from "../../buildkite-workflow.ts";
import { getGitlabCiLocation, type GitlabCiDocument } from "../../gitlab-ci-workflow.ts";
import { getCircleCiLocation, type CircleCiDocument } from "../../circleci-workflow.ts";
import { reifyDiagnostic, type DiagnosticBlueprint } from "../../reification.ts";

type CIWorkflow = WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument;

interface LegacyDetails {
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

function isBlueprintDetails(
  details: LegacyDetails | DiagnosticBlueprint,
): details is DiagnosticBlueprint {
  return "repair" in details;
}

function isGitlabCiDocument(doc: CIWorkflow): doc is GitlabCiDocument {
  return "kind" in doc && doc.kind === "gitlab-ci";
}

function isCircleCiDocument(doc: CIWorkflow): doc is CircleCiDocument {
  return "kind" in doc && doc.kind === "circleci";
}

export function buildDiagnostic(
  workflow: CIWorkflow,
  meta: RuleMeta,
  node: Node | undefined,
  details: (LegacyDetails | DiagnosticBlueprint) & {
    severity?: Severity;
    confidence?: Confidence;
    location?: SourceLocation;
  },
): Diagnostic {
  if (isBlueprintDetails(details)) {
    return reifyDiagnostic(meta, workflow, node, details, {
      severity: details.severity,
      confidence: details.confidence,
      location: details.location,
    });
  }

  const severity = details.severity ?? meta.severity;
  const confidence = details.confidence ?? meta.confidence;
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
  return {
    ruleId: meta.id,
    severity,
    confidence,
    scope: details.scope,
    docsPath: meta.docsPath,
    workflow: workflow.relativePath,
    location: details.location ?? docLocation,
    message: details.message,
    why: details.why,
    suggestion: details.suggestion,
    measurementHint: details.measurementHint,
    aiHandoff: details.aiHandoff,
    score: details.score,
  };
}
