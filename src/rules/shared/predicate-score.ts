import type { Predicate } from "./predicate.ts";

export interface WeightedPredicate {
  pred: Predicate;
  weight: number;
  label?: string;
}

interface WeightedPredicateContribution {
  label: string;
  matched: boolean;
  weight: number;
}

interface WeightedPredicateResult {
  totalScore: number;
  contributions: WeightedPredicateContribution[];
}

function evaluateSourceOnly(wp: WeightedPredicate, source: string): boolean {
  if (wp.pred.kind === "source-contains") {
    return source.includes(wp.pred.pattern);
  }
  if (wp.pred.kind === "true") {
    return true;
  }
  return false;
}

function evaluateWeightedPredicates(
  wps: WeightedPredicate[],
  source: string,
): WeightedPredicateResult {
  const contributions: WeightedPredicateContribution[] = [];
  let totalScore = 0;
  for (const wp of wps) {
    const matched = evaluateSourceOnly(wp, source);
    contributions.push({
      label: wp.label ?? wp.pred.kind,
      matched,
      weight: wp.weight,
    });
    if (matched) {
      totalScore += wp.weight;
    }
  }
  return { totalScore, contributions };
}

export function predicateToPrecheck(
  wps: WeightedPredicate[],
): (workflow: { source?: string }) => number {
  return (workflow) => evaluateWeightedPredicates(wps, workflow.source ?? "").totalScore;
}
