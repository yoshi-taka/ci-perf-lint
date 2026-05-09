export type EvidenceStrength = "strong" | "medium" | "weak";

export interface GradedEvidence<T> {
  readonly value: T;
  readonly strength: EvidenceStrength;
  readonly signals: readonly string[];
}

export function strong<T>(value: T, ...signals: string[]): GradedEvidence<T> {
  return { value, strength: "strong", signals };
}

export function medium<T>(value: T, ...signals: string[]): GradedEvidence<T> {
  return { value, strength: "medium", signals };
}

export function weak<T>(value: T, ...signals: string[]): GradedEvidence<T> {
  return { value, strength: "weak", signals };
}

function strengthPriority(s: EvidenceStrength): number {
  switch (s) {
    case "strong":
      return 3;
    case "medium":
      return 2;
    case "weak":
      return 1;
  }
}

export function meetsMinimum(
  evidence: GradedEvidence<boolean>,
  minimum: EvidenceStrength,
): boolean {
  if (!evidence.value) {
    return false;
  }
  return strengthPriority(evidence.strength) >= strengthPriority(minimum);
}
