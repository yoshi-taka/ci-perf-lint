import type { Diagnostic } from "./types.ts";
import type { DiagnosticTransform } from "./rules/shared/diagnostic-transform.ts";

export interface StabilityIteration {
  iteration: number;
  score: number;
  whyLength: number;
  aiHandoffLength: number;
}

export interface StabilityResult {
  stable: boolean;
  converged: boolean;
  amplificationDetected: boolean;
  repeatedScoreGrowth: boolean;
  maxObservedDelta: number;
  iterations: StabilityIteration[];
}

function valuesUnchanged(a: Diagnostic, b: Diagnostic): boolean {
  return (
    a.score === b.score &&
    a.why === b.why &&
    a.aiHandoff === b.aiHandoff &&
    a.severity === b.severity &&
    a.suggestion === b.suggestion &&
    a.measurementHint === b.measurementHint &&
    a.message === b.message
  );
}

export function simulateRepeatedTransform(
  transform: DiagnosticTransform,
  sample: Diagnostic,
  iterations = 10,
): StabilityResult {
  const tracked: StabilityIteration[] = [];
  let current = sample;

  for (let i = 0; i < iterations; i++) {
    const next = transform(current);
    tracked.push({
      iteration: i + 1,
      score: next.score,
      whyLength: next.why.length,
      aiHandoffLength: next.aiHandoff.length,
    });

    if (valuesUnchanged(next, current)) {
      break;
    }
    current = next;
  }

  const deltas: number[] = [];
  for (let i = 1; i < tracked.length; i++) {
    deltas.push(tracked[i]!.score - tracked[i - 1]!.score);
  }

  const maxObservedDelta = deltas.length > 0 ? Math.max(...deltas.map(Math.abs)) : 0;
  const converged = tracked.length < iterations;

  const last = tracked[tracked.length - 1]!;
  const prev = tracked.length >= 2 ? tracked[tracked.length - 2]! : null;
  const growingAtEnd =
    prev !== null &&
    (last.score > prev.score ||
      last.whyLength > prev.whyLength ||
      last.aiHandoffLength > prev.aiHandoffLength);

  const amplificationDetected = growingAtEnd;
  const repeatedScoreGrowth =
    deltas.length >= 3 &&
    deltas[0]! > 0 &&
    deltas[deltas.length - 1]! > 0 &&
    deltas[deltas.length - 2]! > 0;
  const stable = converged && !amplificationDetected;

  return {
    stable,
    converged,
    amplificationDetected,
    repeatedScoreGrowth,
    maxObservedDelta,
    iterations: tracked,
  };
}
