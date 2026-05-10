import type { Confidence, RuleMeta, Severity, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { ProvenancedDiagnostic, RepositoryDiagnosticSource } from "../diagnostic-source.ts";
import {
  reifyRepositoryDiagnosticFromSource,
  type DiagnosticDetails,
  type LegacyDiagnosticDetails,
  type BlueprintDiagnosticDetails,
  getDetailTag,
  type RepairOp,
} from "../reification.ts";

const fallbackRepositoryWorkflowPath = ".github/workflows/ci.yml";

interface LegacyRepositoryDetailsInput {
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

interface BlueprintRepositoryDetailsInput {
  message: string;
  why: string;
  repair: RepairOp;
  measurementHint: string;
  score: number;
  location: SourceLocation;
  severity?: Severity;
  confidence?: Confidence;
}

function isBlueprintDetails(
  details: LegacyRepositoryDetailsInput | BlueprintRepositoryDetailsInput,
): details is BlueprintRepositoryDetailsInput {
  return "repair" in details;
}

function toTaggedDetails(
  details: LegacyRepositoryDetailsInput | BlueprintRepositoryDetailsInput,
): DiagnosticDetails {
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
    scope: "repository",
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

export function buildRepositoryDiagnostic(
  repository: RepositorySignals,
  meta: RuleMeta,
  details: LegacyRepositoryDetailsInput | BlueprintRepositoryDetailsInput,
): ProvenancedDiagnostic<RepositoryDiagnosticSource> {
  const taggedDetails = toTaggedDetails(details);

  if (getDetailTag(taggedDetails) === "blueprint") {
    const blueprintDetails = taggedDetails as BlueprintDiagnosticDetails;
    const location = blueprintDetails.location!;
    return reifyRepositoryDiagnosticFromSource(
      meta,
      {
        kind: "repository",
        workflowPath: repository.primaryWorkflowPath ?? fallbackRepositoryWorkflowPath,
        location,
      },
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
      },
    );
  }

  const legacyDetails = taggedDetails as LegacyDiagnosticDetails;
  const severity = legacyDetails.severity ?? meta.severity;
  const confidence = legacyDetails.confidence ?? meta.confidence;
  const location = legacyDetails.location!;
  const source: RepositoryDiagnosticSource = {
    kind: "repository",
    workflowPath: repository.primaryWorkflowPath ?? fallbackRepositoryWorkflowPath,
    location,
  };
  return reifyRepositoryDiagnosticFromSource(
    meta,
    source,
    {
      message: legacyDetails.message,
      why: legacyDetails.why,
      suggestion: legacyDetails.suggestion,
      measurementHint: legacyDetails.measurementHint,
      aiHandoff: legacyDetails.aiHandoff,
      score: legacyDetails.score,
      location,
    },
    {
      severity,
      confidence,
    },
  );
}
