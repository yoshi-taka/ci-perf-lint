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
    case "javascript-linting":
      return gateState.hasJavaScriptLinting;
    case "javascript-formatting":
      return gateState.hasJavaScriptFormatting;
    case "javascript-imports":
      return gateState.hasJavaScriptImports;
    case "javascript-build-config":
      return gateState.hasJavaScriptBuildConfig;
    case "javascript-package-scripts":
      return gateState.hasJavaScriptPackageScripts;
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

function repositoryLikelyUsesJavaScriptTooling(context: RepositoryDiagnosticContext): boolean {
  const { repository } = context;
  return (
    context.workflows.length > 0 &&
    (context.workflows.some((workflow) => workflowLooksJavaScriptHeavy(workflow)) ||
      repository.eslint.usesEslint ||
      repository.eslint.usesOxlint ||
      repository.prettier.usesPrettier ||
      repository.prettier.usesOxfmt ||
      repository.frameworks.usesNextjs ||
      repository.frameworks.usesStorybook ||
      repository.frameworks.usesVite ||
      repository.frameworks.usesAstro ||
      repository.frameworks.usesSvelteKit ||
      repository.frameworks.usesSolidStart ||
      repository.frameworks.usesTurbo ||
      repository.frameworks.usesNx ||
      repository.frameworks.usesLerna ||
      repository.frameworks.usesAngularCli ||
      repository.typescript.versionSpec !== undefined ||
      repository.jest.versionSpec !== undefined ||
      repository.jest.jsdomVersionSpec !== undefined ||
      repository.tailwind.usesTailwind ||
      repository.husky.usesHusky ||
      repository.husky.usesLintStaged ||
      repository.babel.usesBabel ||
      repository.nativePackages.node.length > 0)
  );
}

function repositoryLikelyUsesJavaScriptLinting(context: RepositoryDiagnosticContext): boolean {
  const { eslint, husky } = context.repository;
  return (
    eslint.usesEslint ||
    eslint.usesOxlint ||
    eslint.hasConfig ||
    eslint.pluginNames.length > 0 ||
    husky.usesHusky ||
    husky.usesLintStaged ||
    context.workflows.some((workflow) => /\b(?:eslint|oxlint)\b/i.test(workflow.source ?? ""))
  );
}

function repositoryLikelyUsesJavaScriptFormatting(context: RepositoryDiagnosticContext): boolean {
  const { prettier, tailwind } = context.repository;
  return (
    prettier.usesPrettier ||
    prettier.usesOxfmt ||
    prettier.hasConfig ||
    prettier.pluginNames.length > 0 ||
    tailwind.usesTailwind ||
    context.workflows.some((workflow) =>
      /\b(?:prettier|oxfmt|tailwind)\b/i.test(workflow.source ?? ""),
    )
  );
}

function repositoryLikelyUsesJavaScriptImports(context: RepositoryDiagnosticContext): boolean {
  const { eslint, frameworks, typescript } = context.repository;
  return (
    eslint.usesImportPlugin ||
    eslint.usesImportXPlugin ||
    eslint.usesNoBarrelFilesPlugin ||
    eslint.usesBarrelFilesPlugin ||
    frameworks.usesVite ||
    frameworks.usesNextjs ||
    frameworks.usesAstro ||
    frameworks.usesSvelteKit ||
    frameworks.usesSolidStart ||
    typescript.versionSpec !== undefined
  );
}

function repositoryLikelyUsesJavaScriptBuildConfig(context: RepositoryDiagnosticContext): boolean {
  const { frameworks, babel, typescript, jest } = context.repository;
  return (
    frameworks.usesNextjs ||
    frameworks.usesStorybook ||
    frameworks.usesTurbo ||
    frameworks.usesNx ||
    frameworks.usesLerna ||
    frameworks.usesGradle ||
    frameworks.usesAngularCli ||
    babel.usesBabel ||
    typescript.versionSpec !== undefined ||
    jest.versionSpec !== undefined ||
    context.workflows.some((workflow) =>
      /\b(?:webpack|rspack|babel|ts-loader|fork-ts-checker|next build|vite build|storybook)\b/i.test(
        workflow.source ?? "",
      ),
    )
  );
}

function repositoryLikelyUsesJavaScriptPackageScripts(
  context: RepositoryDiagnosticContext,
): boolean {
  const { npm, nativePackages } = context.repository;
  return (
    npm.lifecycleHookScripts.length > 0 ||
    npm.npmrcFiles.length > 0 ||
    npm.npmrcRelevantSettings.length > 0 ||
    npm.packageScriptEnvReferences.length > 0 ||
    npm.workflowEnvReferences.length > 0 ||
    nativePackages.node.length > 0 ||
    context.workflows.some((workflow) => /\b(?:npm|pnpm|yarn|bun)\b/i.test(workflow.source ?? ""))
  );
}

function repositoryLikelyUsesJavaScriptFrameworks(context: RepositoryDiagnosticContext): boolean {
  const { frameworks, tailwind, jest } = context.repository;
  return (
    frameworks.usesNextjs ||
    frameworks.usesStorybook ||
    tailwind.usesTailwind ||
    jest.versionSpec !== undefined
  );
}

function repositoryLikelyUsesRust(context: RepositoryDiagnosticContext): boolean {
  return (
    context.repository.rust.hasCargoToml ||
    context.workflows.some((workflow) => /\b(?:cargo|rustc|nextest)\b/i.test(workflow.source ?? ""))
  );
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
    repositoryLikelyUsesJavaScriptTooling(context)
      ? Promise.resolve(true)
      : timedGate("javascript-tooling", () => looksLikeJavaScriptRepository(context.scanContext)),
    repositoryLikelyUsesJavaScriptFrameworks(context)
      ? Promise.resolve(true)
      : timedGate("javascript-frameworks", () =>
          looksLikeJavaScriptFrameworksRepository(context.scanContext),
        ),
    repositoryLikelyUsesRust(context)
      ? Promise.resolve(true)
      : timedGate("rust", () => looksLikeRustRepository(context.scanContext)),
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
    hasJavaScriptLinting: repositoryLikelyUsesJavaScriptLinting(context),
    hasJavaScriptFormatting: repositoryLikelyUsesJavaScriptFormatting(context),
    hasJavaScriptImports: repositoryLikelyUsesJavaScriptImports(context),
    hasJavaScriptBuildConfig: repositoryLikelyUsesJavaScriptBuildConfig(context),
    hasJavaScriptPackageScripts: repositoryLikelyUsesJavaScriptPackageScripts(context),
    hasJavaScriptFrameworks,
    hasRust,
    hasCdkManifest,
    hasCdkBucketDeployment,
  };
}
