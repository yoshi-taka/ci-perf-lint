import type { WorkflowStep } from "../../workflow.ts";
import type { DependencyFamily, SetupActionKind } from "./tools.ts";
import { getStepFacts } from "./step-facts.ts";

export function usesSetupAction(stepUses: string | undefined, prefix: string): boolean {
  return typeof stepUses === "string" && stepUses.toLowerCase().startsWith(prefix);
}

export function getSetupActionKind(step: WorkflowStep): SetupActionKind | undefined {
  return getStepFacts(step).setupActionKind;
}

export function getDependencyFamiliesUsedBySetupAction(
  action: SetupActionKind,
): DependencyFamily[] {
  switch (action) {
    case "node":
      return ["npm", "pnpm", "yarn"];
    case "python":
      return ["pip", "pipenv", "poetry"];
    case "go":
      return ["go"];
    case "java":
      return ["maven", "gradle", "sbt"];
    case "ruby":
      return ["bundler"];
    case "dotnet":
      return ["nuget"];
    default:
      const _exhaustive: never = action;
      throw new Error(`Unhandled SetupActionKind: ${String(_exhaustive)}`);
  }
}

export function isSetupActionRelevantForDependencyFamily(
  action: SetupActionKind,
  family: DependencyFamily,
): boolean {
  return getDependencyFamiliesUsedBySetupAction(action).includes(family);
}

export function isOutdatedSetupAction(uses: string): boolean {
  return /actions\/setup-(node|python|go)@v[12]\b/i.test(uses);
}
