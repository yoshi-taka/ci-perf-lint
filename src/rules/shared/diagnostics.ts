import type { Node } from "yaml";
import type { Confidence, Diagnostic, RuleMeta, Severity, SourceLocation } from "../../types.ts";
import { getLocation, type WorkflowDocument } from "../../workflow.ts";
import { getPipelineLocation, type PipelineDocument } from "../../buildkite-workflow.ts";
import { getGitlabCiLocation, type GitlabCiDocument } from "../../gitlab-ci-workflow.ts";
import { getCircleCiLocation, type CircleCiDocument } from "../../circleci-workflow.ts";

function isGitlabCiDocument(
  doc: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
): doc is GitlabCiDocument {
  return "kind" in doc && doc.kind === "gitlab-ci";
}

function isCircleCiDocument(
  doc: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
): doc is CircleCiDocument {
  return "kind" in doc && doc.kind === "circleci";
}

export function buildDiagnostic(
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
  meta: RuleMeta,
  node: Node | undefined,
  details: Omit<
    Diagnostic,
    "ruleId" | "severity" | "confidence" | "docsPath" | "workflow" | "location"
  > & {
    severity?: Severity;
    confidence?: Confidence;
    location?: SourceLocation;
  },
): Diagnostic {
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
