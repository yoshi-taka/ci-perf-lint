import type { WorkflowStep } from "../../workflow.ts";
import type { DependencyFamily, SetupActionKind } from "./tools.ts";

const setupActionKindCache = new WeakMap<WorkflowStep, SetupActionKind | undefined>();

export function usesSetupAction(stepUses: string | undefined, prefix: string): boolean {
  return typeof stepUses === "string" && stepUses.toLowerCase().startsWith(prefix);
}

export function getSetupActionKind(step: WorkflowStep): SetupActionKind | undefined {
  const cached = setupActionKindCache.get(step);
  if (cached !== undefined || setupActionKindCache.has(step)) {
    return cached;
  }

  const uses = step.uses?.toLowerCase() ?? "";

  if (uses.startsWith("actions/setup-node@")) {
    setupActionKindCache.set(step, "node");
    return "node";
  }

  if (uses.startsWith("actions/setup-python@")) {
    setupActionKindCache.set(step, "python");
    return "python";
  }

  if (uses.startsWith("actions/setup-go@")) {
    setupActionKindCache.set(step, "go");
    return "go";
  }

  if (uses.startsWith("actions/setup-java@")) {
    setupActionKindCache.set(step, "java");
    return "java";
  }

  if (uses.startsWith("ruby/setup-ruby@")) {
    setupActionKindCache.set(step, "ruby");
    return "ruby";
  }

  if (uses.startsWith("actions/setup-dotnet@")) {
    setupActionKindCache.set(step, "dotnet");
    return "dotnet";
  }

  setupActionKindCache.set(step, undefined);
  return undefined;
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
