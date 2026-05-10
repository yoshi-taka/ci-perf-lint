import type { Confidence, Diagnostic, RuleMeta, Severity, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { reifyRepositoryDiagnostic, type DiagnosticBlueprint } from "../reification.ts";

interface LegacyRepositoryDetails {
  message: string;
  why: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: string;
  score: number;
  location: SourceLocation;
}

const fallbackRepositoryWorkflowPath = ".github/workflows/ci.yml";

function isBlueprintDetails(
  details: LegacyRepositoryDetails | DiagnosticBlueprint,
): details is DiagnosticBlueprint {
  return "repair" in details;
}

export function buildRepositoryDiagnostic(
  repository: RepositorySignals,
  meta: RuleMeta,
  details: (LegacyRepositoryDetails | DiagnosticBlueprint) & {
    location: SourceLocation;
    severity?: Severity;
    confidence?: Confidence;
  },
): Diagnostic {
  if (isBlueprintDetails(details)) {
    return reifyRepositoryDiagnostic(repository, meta, details, details.location, {
      severity: details.severity,
      confidence: details.confidence,
    });
  }
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
