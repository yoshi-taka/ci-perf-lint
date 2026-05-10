import type { Confidence, RuleMeta, Severity, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { ProvenancedDiagnostic, RepositoryDiagnosticSource } from "../diagnostic-source.ts";
import { reifyRepositoryDiagnosticFromSource, type DiagnosticBlueprint } from "../reification.ts";

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
): ProvenancedDiagnostic<RepositoryDiagnosticSource> {
  if (isBlueprintDetails(details)) {
    return reifyRepositoryDiagnosticFromSource(
      meta,
      {
        kind: "repository",
        workflowPath: repository.primaryWorkflowPath ?? fallbackRepositoryWorkflowPath,
        location: details.location,
      },
      details,
      {
        severity: details.severity,
        confidence: details.confidence,
      },
    );
  }
  const severity = details.severity ?? meta.severity;
  const confidence = details.confidence ?? meta.confidence;
  const source: RepositoryDiagnosticSource = {
    kind: "repository",
    workflowPath: repository.primaryWorkflowPath ?? fallbackRepositoryWorkflowPath,
    location: details.location,
  };
  return reifyRepositoryDiagnosticFromSource(meta, source, details, {
    severity,
    confidence,
  });
}
