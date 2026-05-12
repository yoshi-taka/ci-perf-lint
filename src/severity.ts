import type { Severity } from "./types.ts";

export const severityRank: Record<Severity, number> = {
  suggestion: 0,
  warning: 1,
  error: 2,
};

export function joinSeverity(a: Severity, b: Severity): Severity {
  return severityRank[a] >= severityRank[b] ? a : b;
}

export function severityCompare(a: Severity, b: Severity): number {
  return severityRank[a] - severityRank[b];
}
