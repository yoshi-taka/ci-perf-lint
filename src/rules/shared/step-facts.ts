import type { WorkflowStep } from "../../workflow.ts";
import type { SetupActionKind } from "./tools-text.ts";
import {
  detectInstallCommandFromText,
  detectLintToolFromText,
  detectBuildToolFromText,
  detectPythonToolFromText,
  detectRedundantBootstrapToolFromText,
  KNOWN_INSTALLER_ACTIONS,
} from "./tools-text.ts";

export interface StepFacts {
  readonly stepText: string;
  readonly loweredStepText: string;
  readonly installCommand?: string;
  readonly lintTool?: string;
  readonly buildTool?: string;
  readonly pythonTool?: string;
  readonly redundantBootstrapTool?: string;
  readonly setupActionKind?: SetupActionKind;
  readonly isManualCacheStep: boolean;
  readonly hasDependencyCacheConfig: boolean;
}

const stepFactsCache = new WeakMap<WorkflowStep, StepFacts>();

export function getStepFacts(step: WorkflowStep): StepFacts {
  const cached = stepFactsCache.get(step);
  if (cached) {
    return cached;
  }

  const facts = computeStepFacts(step);
  stepFactsCache.set(step, facts);
  return facts;
}

function computeStepFacts(step: WorkflowStep): StepFacts {
  const stepText = `${step.name ?? ""} ${step.uses ?? ""} ${step.run ?? ""}`;
  const loweredStepText = stepText.toLowerCase();
  const uses = step.uses?.toLowerCase() ?? "";

  let setupActionKind: SetupActionKind | undefined;
  if (uses.startsWith("actions/setup-node@")) {
    setupActionKind = "node";
  } else if (uses.startsWith("actions/setup-python@")) {
    setupActionKind = "python";
  } else if (uses.startsWith("actions/setup-go@")) {
    setupActionKind = "go";
  } else if (uses.startsWith("actions/setup-java@")) {
    setupActionKind = "java";
  } else if (uses.startsWith("ruby/setup-ruby@")) {
    setupActionKind = "ruby";
  } else if (uses.startsWith("actions/setup-dotnet@")) {
    setupActionKind = "dotnet";
  }

  let installCommand: string | undefined = detectInstallCommandFromText(step.run ?? "");
  if (!installCommand) {
    for (const [family, prefixes] of KNOWN_INSTALLER_ACTIONS) {
      if (prefixes.some((prefix) => uses.startsWith(prefix))) {
        installCommand = family;
        break;
      }
    }
  }

  const isManualCacheStep =
    uses.startsWith("actions/cache@") ||
    uses.startsWith("actions/cache/restore@") ||
    uses.startsWith("actions/cache/save@");

  let hasDependencyCacheConfig = false;
  if (step.uses && step.with) {
    const cacheValue = step.with.cache;
    const cacheDependencyPath = step.with["cache-dependency-path"];
    hasDependencyCacheConfig =
      (typeof cacheValue === "string" && cacheValue.trim().length > 0) ||
      (typeof cacheDependencyPath === "string" && cacheDependencyPath.trim().length > 0);
  }

  return {
    stepText,
    loweredStepText,
    installCommand,
    lintTool: detectLintToolFromText(step.name ?? "", step.run ?? ""),
    buildTool: detectBuildToolFromText(step.name ?? "", step.run ?? ""),
    pythonTool: detectPythonToolFromText(step.name ?? "", step.run ?? ""),
    redundantBootstrapTool: detectRedundantBootstrapToolFromText(step.run ?? ""),
    setupActionKind,
    isManualCacheStep,
    hasDependencyCacheConfig,
  };
}
