import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type {
  RepositoryDiagnosticContext,
  RepositoryDiagnosticGate,
  RepositoryDiagnosticGateState,
} from "./collector-types.ts";
import {
  looksLikeJavaScriptFrameworksRepository,
  looksLikeJavaScriptRepository,
  looksLikeRustRepository,
  repositoryLooksLargeFilesHeavy,
  repositoryLooksPytestHeavy,
  workflowLooksDatadogHeavy,
  workflowLooksDockerBuildHeavy,
  workflowLooksElixirHeavy,
  workflowLooksJavaScriptHeavy,
  workflowLooksPythonHeavy,
  workflowLooksTerraformHeavy,
} from "./imports-shared.ts";
import { repositoryHasRenovateConfig } from "./renovate-rebase-when.ts";

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

async function timedGate<T>(label: string, collect: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  const value = await collect();
  if (timingsEnabled()) {
    process.stderr.write(
      `[timing] diagnostics gate ${label}=${(performance.now() - startedAt).toFixed(1)}ms\n`,
    );
  }
  return value;
}

export function collectorGateMatches(
  gate: RepositoryDiagnosticGate,
  gateState: RepositoryDiagnosticGateState,
): boolean {
  switch (gate) {
    case "javascript-heavy":
      return gateState.hasJavaScriptHeavyWorkflow;
    case "javascript-tooling":
      return gateState.hasJavaScriptTooling;
    case "docker-heavy":
      return gateState.hasDockerHeavyWorkflow;
    case "large-files":
      return gateState.hasLargeFiles;
    case "terraform-heavy":
      return gateState.hasTerraformHeavyWorkflow;
    case "datadog-heavy":
      return gateState.hasDatadogHeavyWorkflow;
    case "pytest":
      return gateState.hasPytest;
    case "python-heavy":
      return gateState.hasPythonHeavyWorkflow;
    case "renovate":
      return gateState.hasRenovateConfig;
    case "husky":
      return gateState.hasHusky;
    case "javascript-frameworks":
      return gateState.hasJavaScriptFrameworks;
    case "rust":
      return gateState.hasRust;
    case "cdk-manifest":
      return gateState.hasCdkManifest;
    case "cdk-bucket-deployment":
      return gateState.hasCdkBucketDeployment;
    case "elixir-heavy":
      return gateState.hasElixirHeavyWorkflow;
  }
}

function collectSignalGateState(
  workflows: WorkflowDocument[],
): Pick<
  RepositoryDiagnosticGateState,
  | "hasJavaScriptHeavyWorkflow"
  | "hasDockerHeavyWorkflow"
  | "hasTerraformHeavyWorkflow"
  | "hasDatadogHeavyWorkflow"
  | "hasPythonHeavyWorkflow"
  | "hasElixirHeavyWorkflow"
> {
  let hasJavaScriptHeavyWorkflow = false;
  let hasDockerHeavyWorkflow = false;
  let hasTerraformHeavyWorkflow = false;
  let hasDatadogHeavyWorkflow = false;
  let hasPythonHeavyWorkflow = false;
  let hasElixirHeavyWorkflow = false;

  for (const workflow of workflows) {
    if (!hasJavaScriptHeavyWorkflow && workflowLooksJavaScriptHeavy(workflow)) {
      hasJavaScriptHeavyWorkflow = true;
    }

    if (!hasDockerHeavyWorkflow && workflowLooksDockerBuildHeavy(workflow)) {
      hasDockerHeavyWorkflow = true;
    }

    if (!hasTerraformHeavyWorkflow && workflowLooksTerraformHeavy(workflow)) {
      hasTerraformHeavyWorkflow = true;
    }

    if (!hasDatadogHeavyWorkflow && workflowLooksDatadogHeavy(workflow)) {
      hasDatadogHeavyWorkflow = true;
    }

    if (!hasPythonHeavyWorkflow && workflowLooksPythonHeavy(workflow)) {
      hasPythonHeavyWorkflow = true;
    }

    if (!hasElixirHeavyWorkflow && workflowLooksElixirHeavy(workflow)) {
      hasElixirHeavyWorkflow = true;
    }

    if (
      hasJavaScriptHeavyWorkflow &&
      hasDockerHeavyWorkflow &&
      hasTerraformHeavyWorkflow &&
      hasDatadogHeavyWorkflow &&
      hasPythonHeavyWorkflow &&
      hasElixirHeavyWorkflow
    ) {
      break;
    }
  }

  return {
    hasJavaScriptHeavyWorkflow,
    hasDockerHeavyWorkflow,
    hasTerraformHeavyWorkflow,
    hasDatadogHeavyWorkflow,
    hasPythonHeavyWorkflow,
    hasElixirHeavyWorkflow,
  };
}

async function repositoryHasCdkManifest(scanContext: RepositoryScanContext): Promise<boolean> {
  return scanContext.pathExists(scanContext.resolve("cdk.out", "manifest.json"));
}

async function repositoryHasCdkBucketDeployment(
  context: RepositoryDiagnosticContext,
): Promise<boolean> {
  const packageJson = await context.scanContext.loadPackageJson();
  const deps = packageJson.value;
  if (deps) {
    for (const section of [deps.dependencies, deps.devDependencies, deps.peerDependencies]) {
      if (section && typeof section === "object") {
        for (const name of Object.keys(section as Record<string, unknown>)) {
          if (/^(?:@?aws-cdk(?:-lib)?(?:\/.+)?|aws-cdk-lib)$/.test(name)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

export async function collectRepositoryDiagnosticGateState(
  context: RepositoryDiagnosticContext,
): Promise<RepositoryDiagnosticGateState> {
  const signalGates = collectSignalGateState(context.workflows);
  const [
    hasLargeFiles,
    hasPytest,
    hasRenovateConfig,
    hasJavaScriptTooling,
    hasJavaScriptFrameworks,
    hasRust,
    hasCdkManifest,
    hasCdkBucketDeployment,
  ] = await Promise.all([
    timedGate("large-files", () => repositoryLooksLargeFilesHeavy(context.scanContext)),
    timedGate("pytest", () => repositoryLooksPytestHeavy(context.scanContext, context.workflows)),
    timedGate("renovate", () => repositoryHasRenovateConfig(context.scanContext)),
    timedGate("javascript-tooling", () => looksLikeJavaScriptRepository(context.scanContext)),
    timedGate("javascript-frameworks", () =>
      looksLikeJavaScriptFrameworksRepository(context.scanContext),
    ),
    timedGate("rust", () => looksLikeRustRepository(context.scanContext)),
    timedGate("cdk-manifest", () => repositoryHasCdkManifest(context.scanContext)),
    timedGate("cdk-bucket-deployment", () => repositoryHasCdkBucketDeployment(context)),
  ]);

  return {
    ...signalGates,
    hasLargeFiles,
    hasPytest,
    hasRenovateConfig,
    hasHusky: context.repository.husky.hookFileCount > 0,
    hasJavaScriptTooling,
    hasJavaScriptFrameworks,
    hasRust,
    hasCdkManifest,
    hasCdkBucketDeployment,
  };
}
