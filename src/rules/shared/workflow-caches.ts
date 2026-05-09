import type { WorkflowDocument, WorkflowStep } from "../../workflow.ts";
import type { DependencyFamily } from "./tools.ts";
import { getStepFacts } from "./step-facts.ts";
import {
  getSetupActionKind,
  isSetupActionRelevantForDependencyFamily,
} from "./workflow-setup-actions.ts";

const manualCachePathMatchers = {
  npm: /(^|\n|\/)\.npm(\/|$)|npm-cache/,
  pnpm: /\.pnpm-store|pnpm-store|store\/v3/,
  yarn: /\.yarn\/cache|\.yarn\/install-state|yarn-cache/,
  bun: /\.bun|bun\/install\/cache/,
  pip: /\.cache\/pip|pip-cache/,
  pipenv: /pipenv|virtualenvs/,
  poetry: /poetry|virtualenvs/,
  uv: /\buv\b|\.cache\/uv/,
  go: /go\/pkg\/mod|\.cache\/go-build/,
  maven: /\.m2\/repository/,
  gradle: /\.gradle\/caches|\.gradle\/wrapper/,
  sbt: /\.ivy2\/cache|coursier|\.sbt/,
  bundler: /vendor\/bundle|\.bundle|rubygems|gems/,
  nuget: /\.nuget\/packages/,
} satisfies Record<DependencyFamily, RegExp>;

function getStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return [];
}

function getCachePathText(step: WorkflowStep): string {
  const pathValue = step.with?.path;
  return getStringList(pathValue).join("\n").toLowerCase();
}

export function hasDependencyCacheConfig(step: WorkflowStep): boolean {
  return getStepFacts(step).hasDependencyCacheConfig;
}

export function isManualCacheStep(step: WorkflowStep): boolean {
  return getStepFacts(step).isManualCacheStep;
}

export function manualCacheStepMatchesDependencyFamily(
  step: WorkflowStep,
  family: DependencyFamily,
): boolean {
  if (!isManualCacheStep(step)) {
    return false;
  }

  const pathText = getCachePathText(step);
  if (pathText.length === 0) {
    return false;
  }

  return manualCachePathMatchers[family].test(pathText);
}

export function workflowHasCachePath(workflow: WorkflowDocument, pathRegex: RegExp): boolean {
  return workflow.jobs.some((job) =>
    job.steps.some((step) => {
      if (!isManualCacheStep(step)) {
        return false;
      }

      const pathText = getCachePathText(step);
      return pathRegex.test(pathText);
    }),
  );
}

export function setupActionHasBuiltInCacheForFamily(
  step: WorkflowStep,
  family: DependencyFamily,
): boolean {
  const action = getSetupActionKind(step);
  if (!action || !isSetupActionRelevantForDependencyFamily(action, family)) {
    return false;
  }

  const cacheValue = step.with?.cache;
  const bundlerCacheValue = step.with?.["bundler-cache"];
  const normalizedCacheValue =
    typeof cacheValue === "string" ? cacheValue.trim().toLowerCase() : cacheValue;
  const normalizedBundlerCacheValue =
    typeof bundlerCacheValue === "string"
      ? bundlerCacheValue.trim().toLowerCase()
      : bundlerCacheValue;

  switch (action) {
    case "node":
      return normalizedCacheValue === family;
    case "python":
      return normalizedCacheValue === family;
    case "go":
      return true;
    case "java":
      return normalizedCacheValue === family;
    case "ruby":
      return normalizedBundlerCacheValue === true || normalizedBundlerCacheValue === "true";
    case "dotnet":
      return normalizedCacheValue === true || normalizedCacheValue === "true";
    default:
      const _exhaustive: never = action;
      throw new Error(`Unhandled SetupActionKind: ${String(_exhaustive)}`);
  }
}
