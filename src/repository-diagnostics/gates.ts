import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type {
  GatePredicate,
  RepositoryDiagnosticContext,
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

export const gates = {
  javascriptHeavy: (s: RepositoryDiagnosticGateState) => s.hasJavaScriptHeavyWorkflow,
  javascriptTooling: (s: RepositoryDiagnosticGateState) => s.hasJavaScriptTooling,
  javascriptLinting: (s: RepositoryDiagnosticGateState) => s.hasJavaScriptLinting,
  javascriptBuildConfig: (s: RepositoryDiagnosticGateState) => s.hasJavaScriptBuildConfig,
  javascriptPackageScripts: (s: RepositoryDiagnosticGateState) => s.hasJavaScriptPackageScripts,
  dockerHeavy: (s: RepositoryDiagnosticGateState) => s.hasDockerHeavyWorkflow,
  terraformHeavy: (s: RepositoryDiagnosticGateState) => s.hasTerraformHeavyWorkflow,
  largeFiles: (s: RepositoryDiagnosticGateState) => s.hasLargeFiles,
  datadogHeavy: (s: RepositoryDiagnosticGateState) => s.hasDatadogHeavyWorkflow,
  pytest: (s: RepositoryDiagnosticGateState) => s.hasPytest,
  pythonHeavy: (s: RepositoryDiagnosticGateState) => s.hasPythonHeavyWorkflow,
  renovate: (s: RepositoryDiagnosticGateState) => s.hasRenovateConfig,
  husky: (s: RepositoryDiagnosticGateState) => s.hasHusky,
  javascriptFrameworks: (s: RepositoryDiagnosticGateState) => s.hasJavaScriptFrameworks,
  rust: (s: RepositoryDiagnosticGateState) => s.hasRust,
  cdkManifest: (s: RepositoryDiagnosticGateState) => s.hasCdkManifest,
  elixirHeavy: (s: RepositoryDiagnosticGateState) => s.hasElixirHeavyWorkflow,
  gradle: (s: RepositoryDiagnosticGateState) => s.hasGradle,
} as const;

export function collectorGateMatches(
  gate: GatePredicate,
  gateState: RepositoryDiagnosticGateState,
): boolean {
  return gate(gateState);
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

async function repositoryHasJavaScriptBuildConfigEvidence(
  scanContext: RepositoryScanContext,
): Promise<boolean> {
  const candidates = [
    "webpack.config.js",
    "webpack.config.ts",
    "webpack.config.mjs",
    "webpack.config.cjs",
    "rspack.config.js",
    "rspack.config.ts",
    "rspack.config.mjs",
    "rspack.config.cjs",
  ] as const;
  const matches = await Promise.all(
    candidates.map((fileName) => scanContext.pathExists(scanContext.resolve(fileName))),
  );
  if (matches.some(Boolean)) {
    return true;
  }

  const packageJsonEntry = await scanContext.loadPackageJson();
  return /"workspaces"\s*:/.test(packageJsonEntry.text ?? "");
}

async function repositoryHasJavaScriptPackageScriptEvidence(
  scanContext: RepositoryScanContext,
): Promise<boolean> {
  const candidates = ["vercel.json", "wrangler.toml", "amplify.yml", "amplify.yaml"] as const;
  const matches = await Promise.all(
    candidates.map((fileName) => scanContext.pathExists(scanContext.resolve(fileName))),
  );
  return matches.some(Boolean);
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
    context.repository.eslint.usesEslint ||
    context.repository.prettier.usesPrettier ||
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

function quickTestJavaScriptTooling(context: RepositoryDiagnosticContext): boolean | undefined {
  const { repository } = context;
  if (
    repository.typescript.versionSpec !== undefined ||
    repository.jest.versionSpec !== undefined ||
    repository.jest.jsdomVersionSpec !== undefined ||
    repository.frameworks.usesNextjs ||
    repository.frameworks.usesVite ||
    repository.frameworks.usesStorybook ||
    repository.frameworks.usesTurbo
  ) {
    return true;
  }
  return undefined;
}

function quickTestJavaScriptFrameworks(context: RepositoryDiagnosticContext): boolean | undefined {
  const { frameworks, tailwind, jest } = context.repository;
  if (
    frameworks.usesNextjs ||
    frameworks.usesStorybook ||
    tailwind.usesTailwind ||
    jest.versionSpec !== undefined
  ) {
    return true;
  }
  return undefined;
}

function quickTestRust(context: RepositoryDiagnosticContext): boolean | undefined {
  if (context.repository.rust.hasCargoToml) {
    return true;
  }
  return undefined;
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
    hasJavaScriptBuildConfigEvidence,
    hasJavaScriptPackageScriptEvidence,
    hasJavaScriptFrameworks,
    hasRust,
    hasCdkManifest,
  ] = await Promise.all([
    timedGate("large-files", () => repositoryLooksLargeFilesHeavy(context.scanContext)),
    timedGate("pytest", () => repositoryLooksPytestHeavy(context.scanContext, context.workflows)),
    timedGate("renovate", () => repositoryHasRenovateConfig(context.scanContext)),
    quickTestJavaScriptTooling(context) !== undefined
      ? Promise.resolve(quickTestJavaScriptTooling(context)!)
      : timedGate("javascript-tooling", () => looksLikeJavaScriptRepository(context.scanContext)),
    repositoryHasJavaScriptBuildConfigEvidence(context.scanContext),
    repositoryHasJavaScriptPackageScriptEvidence(context.scanContext),
    quickTestJavaScriptFrameworks(context) !== undefined
      ? Promise.resolve(quickTestJavaScriptFrameworks(context)!)
      : timedGate("javascript-frameworks", () =>
          looksLikeJavaScriptFrameworksRepository(context.scanContext),
        ),
    quickTestRust(context) !== undefined
      ? Promise.resolve(quickTestRust(context)!)
      : timedGate("rust", () => looksLikeRustRepository(context.scanContext)),
    timedGate("cdk-manifest", () => repositoryHasCdkManifest(context.scanContext)),
  ]);

  return {
    ...signalGates,
    hasLargeFiles,
    hasPytest,
    hasRenovateConfig,
    hasHusky: context.repository.husky.hookFileCount > 0,
    hasJavaScriptTooling,
    hasJavaScriptLinting: repositoryLikelyUsesJavaScriptLinting(context),
    hasJavaScriptBuildConfig:
      repositoryLikelyUsesJavaScriptBuildConfig(context) || hasJavaScriptBuildConfigEvidence,
    hasJavaScriptPackageScripts:
      repositoryLikelyUsesJavaScriptPackageScripts(context) || hasJavaScriptPackageScriptEvidence,
    hasJavaScriptFrameworks,
    hasRust,
    hasCdkManifest,
    hasGradle: context.repository.frameworks.usesGradle,
  };
}
