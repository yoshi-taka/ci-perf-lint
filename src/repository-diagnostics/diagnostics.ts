import type { Confidence, Diagnostic, RuleMeta, Severity, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";

const fallbackRepositoryWorkflowPath = ".github/workflows/ci.yml";

export function buildRepositoryDiagnostic(
  repository: RepositorySignals,
  meta: RuleMeta,
  details: Omit<
    Diagnostic,
    "ruleId" | "severity" | "confidence" | "scope" | "docsPath" | "workflow"
  > & {
    location: SourceLocation;
    severity?: Severity;
    confidence?: Confidence;
  },
): Diagnostic {
  const severity = details.severity ?? meta.severity;
  const confidence = details.confidence ?? meta.confidence;
  return {
    ruleId: meta.id,
    severity,
    confidence,
    scope: "repository",
    docsPath: meta.docsPath,
    workflow: repository.primaryWorkflowPath ?? fallbackRepositoryWorkflowPath,
    location: details.location,
    message: details.message,
    why: details.why,
    suggestion: details.suggestion,
    measurementHint: details.measurementHint,
    aiHandoff: details.aiHandoff,
    score: details.score,
  };
}
