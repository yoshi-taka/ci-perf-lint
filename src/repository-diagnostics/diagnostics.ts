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
  const { severity, confidence, ...rest } = details;
  return {
    ruleId: meta.id,
    severity: severity ?? meta.severity,
    confidence: confidence ?? meta.confidence,
    scope: "repository",
    docsPath: meta.docsPath,
    workflow: repository.primaryWorkflowPath ?? fallbackRepositoryWorkflowPath,
    ...rest,
  };
}
