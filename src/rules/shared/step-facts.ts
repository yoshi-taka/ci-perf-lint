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

  readonly isCheckout: boolean;
  readonly checkoutDepth?: number;
  readonly checkoutSparseCheckout?: string;
  readonly checkoutFilter?: string;

  readonly isDockerBuild: boolean;
  readonly dockerNoCache?: boolean;
  readonly dockerLoad?: boolean;
  readonly dockerCacheFrom?: string;
  readonly dockerCacheTo?: string;
  readonly dockerPlatforms?: string;

  readonly setupCacheParam?: string;
  readonly setupCacheDependencyPath?: string;
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
  let setupCacheParam: string | undefined;
  let setupCacheDependencyPath: string | undefined;
  if (step.uses && step.with) {
    const cacheValue = step.with.cache;
    const cacheDepPath = step.with["cache-dependency-path"];
    hasDependencyCacheConfig =
      (typeof cacheValue === "string" && cacheValue.trim().length > 0) ||
      (typeof cacheDepPath === "string" && cacheDepPath.trim().length > 0);
    if (setupActionKind) {
      setupCacheParam = typeof cacheValue === "string" ? cacheValue : undefined;
      setupCacheDependencyPath = typeof cacheDepPath === "string" ? cacheDepPath : undefined;
    }
  }

  let isCheckout = false;
  let checkoutDepth: number | undefined;
  let checkoutSparseCheckout: string | undefined;
  let checkoutFilter: string | undefined;
  if (uses.startsWith("actions/checkout@")) {
    isCheckout = true;
    const fetchDepth = step.with?.["fetch-depth"];
    if (fetchDepth === 0 || fetchDepth === "0") {
      checkoutDepth = 0;
    } else if (typeof fetchDepth === "number" && fetchDepth > 1) {
      checkoutDepth = fetchDepth;
    } else if (typeof fetchDepth === "string" && /^\d+$/.test(fetchDepth)) {
      const n = Number(fetchDepth);
      if (n > 1) {
        checkoutDepth = n;
      }
    } else if (fetchDepth !== undefined) {
      checkoutDepth = undefined;
    }
    checkoutSparseCheckout =
      typeof step.with?.["sparse-checkout"] === "string" ? step.with["sparse-checkout"] : undefined;
    checkoutFilter = typeof step.with?.filter === "string" ? step.with.filter : undefined;
  }

  const run = step.run ?? "";
  let isDockerBuild = false;
  let dockerNoCache: boolean | undefined;
  let dockerLoad: boolean | undefined;
  let dockerCacheFrom: string | undefined;
  let dockerCacheTo: string | undefined;
  let dockerPlatforms: string | undefined;
  if (uses.startsWith("docker/build-push-action@") || uses.startsWith("depot/build-push-action@")) {
    isDockerBuild = true;
    const noCacheVal = step.with?.["no-cache"];
    dockerNoCache = noCacheVal === true || noCacheVal === "true";
    const loadVal = step.with?.load;
    dockerLoad = loadVal === true || loadVal === "true";
    dockerCacheFrom =
      typeof step.with?.["cache-from"] === "string" ? step.with["cache-from"] : undefined;
    dockerCacheTo = typeof step.with?.["cache-to"] === "string" ? step.with["cache-to"] : undefined;
    dockerPlatforms = typeof step.with?.platforms === "string" ? step.with.platforms : undefined;
  } else if (/\bdocker\s+(?:buildx\s+build|build)\b/i.test(run)) {
    isDockerBuild = true;
    dockerNoCache = /\b--no-cache\b/i.test(run);
    dockerLoad = /\b--load\b/i.test(run);
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
    isCheckout,
    checkoutDepth,
    checkoutSparseCheckout,
    checkoutFilter,
    isDockerBuild,
    dockerNoCache,
    dockerLoad,
    dockerCacheFrom,
    dockerCacheTo,
    dockerPlatforms,
    setupCacheParam,
    setupCacheDependencyPath,
  };
}
