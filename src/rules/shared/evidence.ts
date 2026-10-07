export type EvidenceStrength = "strong" | "medium" | "weak";

export interface GradedEvidence<T> {
  readonly value: T;
  readonly strength: EvidenceStrength;
  readonly signals: readonly string[];
}

export interface HeavyEvidence {
  readonly isHeavy: boolean;
  readonly strength: EvidenceStrength;
  readonly reasons: readonly string[];
  readonly matchedSignals: readonly string[];
}

export interface HeavyWorkflowEvidence {
  readonly isHeavy: boolean;
  readonly strength: EvidenceStrength;
  readonly reasons: readonly string[];
  readonly heavyJobCount: number;
  readonly matchedJobNames: readonly string[];
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

const STRENGTH_RANK: Record<EvidenceStrength, number> = {
  strong: 3,
  medium: 2,
  weak: 1,
};

export function meetsMinimum(
  evidence: GradedEvidence<boolean>,
  minimum: EvidenceStrength,
): GradedEvidence<boolean> {
  const passes = evidence.value && STRENGTH_RANK[evidence.strength] >= STRENGTH_RANK[minimum];
  return { value: passes, strength: evidence.strength, signals: evidence.signals };
}

export function combineStrength(strengths: readonly EvidenceStrength[]): EvidenceStrength {
  let best: EvidenceStrength = "weak";
  for (const s of strengths) {
    if (strengthPriority(s) > strengthPriority(best)) {
      best = s;
    }
  }
  return best;
}
