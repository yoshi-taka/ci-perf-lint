import type { RuleMeta } from "../types.ts";
import { validateImplications, type ImplicationValidationEx } from "../rule-engine/implication.ts";

export type ImpliedChecksValidationEx = ImplicationValidationEx;

export function validateImpliedChecks(
  rules: readonly { meta: RuleMeta }[],
  extraKnownIds?: Iterable<string>,
): ImpliedChecksValidationEx {
  return validateImplications(rules, extraKnownIds);
}
