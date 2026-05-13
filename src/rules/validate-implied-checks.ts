import type { RuleMeta } from "../types.ts";
import { validateImplications, type ImplicationValidation } from "../rule-engine/implication.ts";

export type ImpliedChecksValidation = ImplicationValidation;

export function validateImpliedChecks(
  rules: readonly { meta: RuleMeta }[],
  extraKnownIds?: Iterable<string>,
): ImpliedChecksValidation {
  return validateImplications(rules, extraKnownIds);
}
