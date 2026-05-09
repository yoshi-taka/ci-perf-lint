import type { AuditMode, Diagnostic } from "./types.ts";
import { applySeverityPromotion } from "./severity-promotion.ts";

const actionsPriorityScoreBonus = 30;
const prioritizedActionsFindingLimit = 3;

export function isActionsFinding(finding: Diagnostic): boolean {
  return finding.scope !== "repository";
}

export function findingIncludedInMode(finding: Diagnostic, mode: AuditMode): boolean {
  return mode === "exploratory" || finding.severity !== "suggestion";
}

export function promoteStrictFallbackSuggestions(findings: Diagnostic[]): Diagnostic[] {
  return applySeverityPromotion(findings, "strict");
}

export function findingIncludedInScope(
  finding: Diagnostic,
  workflowOnly: boolean,
  repositoryOnly: boolean,
): boolean {
  if (workflowOnly) {
    return isActionsFinding(finding);
  }

  if (repositoryOnly) {
    return !isActionsFinding(finding);
  }

  return true;
}

export function compareFindings(left: Diagnostic, right: Diagnostic): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (left.workflow < right.workflow) {
    return -1;
  }
  if (left.workflow > right.workflow) {
    return 1;
  }

  if (left.ruleId < right.ruleId) {
    return -1;
  }
  if (left.ruleId > right.ruleId) {
    return 1;
  }

  if (left.location.path < right.location.path) {
    return -1;
  }
  if (left.location.path > right.location.path) {
    return 1;
  }

  if (left.location.line !== right.location.line) {
    return left.location.line - right.location.line;
  }

  if (left.location.column !== right.location.column) {
    return left.location.column - right.location.column;
  }

  if (left.message < right.message) {
    return -1;
  }
  if (left.message > right.message) {
    return 1;
  }
  return 0;
}

export function applyLimitedActionsPriority(findings: Diagnostic[]): Diagnostic[] {
  const prioritizedCandidates: { finding: Diagnostic; index: number }[] = [];

  for (const [index, finding] of findings.entries()) {
    if (!isActionsFinding(finding)) {
      continue;
    }

    prioritizedCandidates.push({ finding, index });
  }

  prioritizedCandidates.sort((left, right) => compareFindings(left.finding, right.finding));

  if (prioritizedCandidates.length > prioritizedActionsFindingLimit) {
    prioritizedCandidates.length = prioritizedActionsFindingLimit;
  }

  const prioritizedIndexes = new Set(prioritizedCandidates.map(({ index }) => index));

  return findings.map((finding, index) =>
    prioritizedIndexes.has(index)
      ? {
          ...finding,
          score: finding.score + actionsPriorityScoreBonus,
        }
      : finding,
  );
}
