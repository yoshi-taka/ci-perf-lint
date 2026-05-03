import type { Diagnostic } from "../../types.ts";

export interface SimilarWorkflowConsensusAdjustment {
  scoreBonus: number;
  why: string;
  aiHandoff: string;
}

interface SimilarWorkflowByWorkflowEvidence {
  workflowPath: string;
  peerCount: number;
  peerWorkflowPaths: string[];
}

interface SimilarWorkflowByJobEvidence {
  workflowPath: string;
  jobId: string;
  peerCount: number;
  peerJobLabels: string[];
}

interface RepositoryWorkflowPrecedent {
  workflowPath: string;
}

interface RepositoryJobPrecedent extends RepositoryWorkflowPrecedent {
  jobId: string;
}

function renderList(values: string[]): string {
  return values.map((value) => `\`${value}\``).join(", ");
}

export function appendPrecedent(
  diagnostic: Diagnostic,
  precedentText: string | undefined,
  aiHandoffText: string | undefined,
): Diagnostic {
  if (!precedentText && !aiHandoffText) {
    return diagnostic;
  }

  return {
    ...diagnostic,
    why: precedentText ? `${diagnostic.why} ${precedentText}` : diagnostic.why,
    aiHandoff: aiHandoffText ? `${diagnostic.aiHandoff} ${aiHandoffText}` : diagnostic.aiHandoff,
  };
}

export function withWorkflowConsensus(
  diagnostic: Diagnostic,
  evidence: SimilarWorkflowByWorkflowEvidence | undefined,
  adjustment: SimilarWorkflowConsensusAdjustment,
  details: {
    peerText: string;
    why: (evidence: SimilarWorkflowByWorkflowEvidence, peerText: string) => string;
    aiHandoff: string;
  },
): Diagnostic {
  if (!evidence) {
    return diagnostic;
  }

  const peerText =
    evidence.peerWorkflowPaths.length > 0
      ? ` ${details.peerText} ${renderList(evidence.peerWorkflowPaths)}.`
      : "";

  return {
    ...diagnostic,
    why: `${diagnostic.why} ${adjustment.why} ${details.why(evidence, peerText)}`,
    aiHandoff: `${diagnostic.aiHandoff} ${adjustment.aiHandoff} ${details.aiHandoff}`,
    score: diagnostic.score + adjustment.scoreBonus,
  };
}

export function withJobConsensus(
  diagnostic: Diagnostic,
  evidence: SimilarWorkflowByJobEvidence | undefined,
  adjustment: SimilarWorkflowConsensusAdjustment,
  details: {
    peerText: string;
    why: (evidence: SimilarWorkflowByJobEvidence, peerText: string) => string;
    aiHandoff: string;
  },
): Diagnostic {
  if (!evidence) {
    return diagnostic;
  }

  const peerText =
    evidence.peerJobLabels.length > 0
      ? ` ${details.peerText} ${renderList(evidence.peerJobLabels)}.`
      : "";

  return {
    ...diagnostic,
    why: `${diagnostic.why} ${adjustment.why} ${details.why(evidence, peerText)}`,
    aiHandoff: `${diagnostic.aiHandoff} ${adjustment.aiHandoff} ${details.aiHandoff}`,
    score: diagnostic.score + adjustment.scoreBonus,
  };
}

export function repositoryWorkflowPrecedents(
  entries: readonly RepositoryWorkflowPrecedent[],
  workflowPath: string,
): string[] {
  return entries
    .filter((entry) => entry.workflowPath !== workflowPath)
    .map((entry) => entry.workflowPath)
    .slice(0, 3);
}

export function repositoryJobPrecedents(
  entries: readonly RepositoryJobPrecedent[],
  workflowPath: string,
  jobId: string,
): string[] {
  return entries
    .filter((entry) => entry.workflowPath !== workflowPath || entry.jobId !== jobId)
    .map((entry) => `${entry.workflowPath}:${entry.jobId}`)
    .slice(0, 3);
}

export function renderPrecedentList(values: string[]): string {
  return renderList(values);
}
