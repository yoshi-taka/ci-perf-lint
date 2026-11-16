import type { Mutant } from "./mutators.ts";

/** Apply a single mutant to the original source. The Lean model in
 * `formal/MutationRunner.lean` describes exactly this splice. */
export function applyMutant(
  source: string,
  mutant: Pick<Mutant, "start" | "end" | "replacement">,
): string {
  return source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.end);
}
