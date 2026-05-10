import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type {
  GatePredicate,
  RepositoryDiagnosticContext,
  RepositoryDiagnosticGateState,
  RepositoryDiagnosticGateResolution,
} from "./collector-types.ts";
import {
  looksLikeJavaScriptFrameworksRepository,
  looksLikeJavaScriptRepository,
  looksLikeRustRepository,
  repositoryLooksLargeFilesHeavy,
  repositoryLooksPytestHeavy,
} from "./imports-shared.ts";
import { meetsMinimum } from "../rules/shared/evidence.ts";
import { getWorkflowFacts } from "../rules/shared/workflow-analysis.ts";
import { repositoryHasRenovateConfig } from "./renovate-rebase-when.ts";
import type { RepositoryFeatureIndex } from "./repository-feature-index.ts";

type GateKey = keyof RepositoryDiagnosticGateState;

const gatePrerequisites: Partial<Record<GateKey, GateKey[]>> = {
  hasJavaScriptLinting: ["hasJavaScriptTooling"],
  hasJavaScriptBuildConfig: ["hasJavaScriptTooling"],
  hasJavaScriptPackageScripts: ["hasJavaScriptTooling"],
  hasJavaScriptFrameworks: ["hasJavaScriptTooling"],
};

const emptyGateState: RepositoryDiagnosticGateState = {
  hasJavaScriptHeavyWorkflow: false,
  hasJavaScriptTooling: false,
  hasJavaScriptLinting: false,
  hasJavaScriptBuildConfig: false,
  hasJavaScriptPackageScripts: false,
  hasDockerHeavyWorkflow: false,
  hasTerraformHeavyWorkflow: false,
  hasLargeFiles: false,
  hasDatadogHeavyWorkflow: false,
  hasPytest: false,
  hasPythonHeavyWorkflow: false,
  hasRenovateConfig: false,
  hasHusky: false,
  hasJavaScriptFrameworks: false,
  hasRust: false,
  hasCdkManifest: false,
  hasElixirHeavyWorkflow: false,
  hasGradle: false,
};

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
  featureIndex: RepositoryFeatureIndex,
): Pick<
  RepositoryDiagnosticGateState,
  | "hasJavaScriptHeavyWorkflow"
  | "hasDockerHeavyWorkflow"
  | "hasTerraformHeavyWorkflow"
  | "hasDatadogHeavyWorkflow"
  | "hasPythonHeavyWorkflow"
  | "hasElixirHeavyWorkflow"
> {
  return {
    hasJavaScriptHeavyWorkflow: featureIndex.ecosystems.has("javascript"),
    hasDockerHeavyWorkflow: featureIndex.ecosystems.has("docker"),
    hasTerraformHeavyWorkflow: featureIndex.ecosystems.has("terraform"),
    hasDatadogHeavyWorkflow: featureIndex.ecosystems.has("datadog"),
    hasPythonHeavyWorkflow: featureIndex.ecosystems.has("python"),
    hasElixirHeavyWorkflow: featureIndex.ecosystems.has("elixir"),
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

function repositoryLikelyUsesJavaScriptLinting(
  context: RepositoryDiagnosticContext,
  observations: JavaScriptGateObservations,
): boolean {
  const { eslint, husky } = context.repository;
  return (
    observations.linting ||
    eslint.usesEslint ||
    eslint.usesOxlint ||
    eslint.hasConfig ||
    eslint.pluginNames.length > 0 ||
    husky.usesHusky ||
    husky.usesLintStaged
  );
}

interface JavaScriptGateObservations {
  tooling: boolean;
  linting: boolean;
  buildConfig: boolean;
  packageScripts: boolean;
  frameworks: boolean;
}

function buildJavaScriptGateObservations(
  context: RepositoryDiagnosticContext,
): JavaScriptGateObservations {
  const { eslint, husky, frameworks, babel, typescript, jest, npm, nativePackages, prettier } =
    context.repository;
  const workflowHasEslintSignal = context.workflows.some(
    (workflow) => getWorkflowFacts(workflow).toolPresence.get("hasEslintSignal") ?? false,
  );
  const workflowHasWebpackOrRspackOrBabel = context.workflows.some(
    (workflow) => getWorkflowFacts(workflow).toolPresence.get("hasWebpackOrRspackOrBabel") ?? false,
  );
  const workflowHasPackageManagerSignal = context.workflows.some(
    (workflow) => getWorkflowFacts(workflow).toolPresence.get("hasNpmOrPnpmOrYarnOrBun") ?? false,
  );

  return {
    tooling:
      typescript.versionSpec !== undefined ||
      jest.versionSpec !== undefined ||
      jest.jsdomVersionSpec !== undefined ||
      frameworks.usesNextjs ||
      frameworks.usesVite ||
      frameworks.usesStorybook ||
      frameworks.usesTurbo ||
      eslint.usesEslint ||
      eslint.usesOxlint ||
      eslint.hasConfig ||
      eslint.pluginNames.length > 0 ||
      husky.usesHusky ||
      husky.usesLintStaged ||
      babel.usesBabel ||
      prettier.usesPrettier ||
      npm.lifecycleHookScripts.length > 0 ||
      npm.npmrcFiles.length > 0 ||
      npm.npmrcRelevantSettings.length > 0 ||
      npm.packageScriptEnvReferences.length > 0 ||
      npm.workflowEnvReferences.length > 0 ||
      nativePackages.node.length > 0 ||
      workflowHasEslintSignal ||
      workflowHasWebpackOrRspackOrBabel ||
      workflowHasPackageManagerSignal,
    linting:
      eslint.usesEslint ||
      eslint.usesOxlint ||
      eslint.hasConfig ||
      eslint.pluginNames.length > 0 ||
      husky.usesHusky ||
      husky.usesLintStaged ||
      workflowHasEslintSignal,
    buildConfig:
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
      eslint.usesEslint ||
      prettier.usesPrettier ||
      workflowHasWebpackOrRspackOrBabel,
    packageScripts:
      npm.lifecycleHookScripts.length > 0 ||
      npm.npmrcFiles.length > 0 ||
      npm.npmrcRelevantSettings.length > 0 ||
      npm.packageScriptEnvReferences.length > 0 ||
      npm.workflowEnvReferences.length > 0 ||
      nativePackages.node.length > 0 ||
      workflowHasPackageManagerSignal,
    frameworks:
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
      workflowHasWebpackOrRspackOrBabel,
  };
}

function repositoryLikelyUsesJavaScriptBuildConfig(
  observations: JavaScriptGateObservations,
): boolean {
  return observations.buildConfig;
}

function repositoryLikelyUsesJavaScriptPackageScripts(
  observations: JavaScriptGateObservations,
): boolean {
  return observations.packageScripts;
}

function quickTestJavaScriptTooling(observations: JavaScriptGateObservations): boolean | undefined {
  if (observations.tooling) {
    return true;
  }
  return undefined;
}

function quickTestJavaScriptFrameworks(
  context: RepositoryDiagnosticContext,
  observations: JavaScriptGateObservations,
): boolean | undefined {
  const { tailwind, jest } = context.repository;
  if (observations.frameworks || tailwind.usesTailwind || jest.versionSpec !== undefined) {
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
): Promise<RepositoryDiagnosticGateResolution> {
  const state: RepositoryDiagnosticGateState = { ...emptyGateState };
  const observability = {
    observed: [] as string[],
    derivedFalse: [] as { gate: string; dueTo: string[] }[],
  };
  const jsObservations = buildJavaScriptGateObservations(context);

  const signalGates = collectSignalGateState(context.featureIndex);
  Object.assign(state, signalGates);

  const [largeFilesEvidence, pytestEvidence, hasRenovateConfig, hasCdkManifest] = await Promise.all(
    [
      timedGate("large-files", () => repositoryLooksLargeFilesHeavy(context.scanContext)),
      timedGate("pytest", () => repositoryLooksPytestHeavy(context.scanContext, context.workflows)),
      timedGate("renovate", () => repositoryHasRenovateConfig(context.scanContext)),
      timedGate("cdk-manifest", () => repositoryHasCdkManifest(context.scanContext)),
    ],
  );
  state.hasLargeFiles = largeFilesEvidence.value;
  const pytestGate = meetsMinimum(pytestEvidence, "medium");
  state.hasPytest = pytestGate.value;
  state.hasRenovateConfig = hasRenovateConfig;
  state.hasCdkManifest = hasCdkManifest;
  observability.observed.push("hasLargeFiles", "hasPytest", "hasRenovateConfig", "hasCdkManifest");

  state.hasHusky = context.repository.husky.hookFileCount > 0;
  state.hasGradle = context.repository.frameworks.usesGradle;

  const jsToolingGate = await evaluateGate(
    "hasJavaScriptTooling",
    [() => quickTestJavaScriptTooling(jsObservations)],
    async () =>
      (
        await timedGate("javascript-tooling", () =>
          looksLikeJavaScriptRepository(context.scanContext),
        )
      ).value,
    state,
  );
  if (jsToolingGate !== undefined) {
    state.hasJavaScriptTooling = jsToolingGate;
    observability.observed.push("hasJavaScriptTooling");
  }

  const jsBuildConfigEvidence = state.hasJavaScriptTooling
    ? await repositoryHasJavaScriptBuildConfigEvidence(context.scanContext)
    : false;
  const jsPackageScriptEvidence = state.hasJavaScriptTooling
    ? await repositoryHasJavaScriptPackageScriptEvidence(context.scanContext)
    : false;

  state.hasJavaScriptLinting = state.hasJavaScriptTooling
    ? repositoryLikelyUsesJavaScriptLinting(context, jsObservations)
    : false;
  state.hasJavaScriptBuildConfig = state.hasJavaScriptTooling
    ? repositoryLikelyUsesJavaScriptBuildConfig(jsObservations) || jsBuildConfigEvidence
    : false;
  state.hasJavaScriptPackageScripts = state.hasJavaScriptTooling
    ? repositoryLikelyUsesJavaScriptPackageScripts(jsObservations) || jsPackageScriptEvidence
    : false;

  const jsFrameworksGate = await evaluateGate(
    "hasJavaScriptFrameworks",
    [() => quickTestJavaScriptFrameworks(context, jsObservations)],
    async () =>
      (
        await timedGate("javascript-frameworks", () =>
          looksLikeJavaScriptFrameworksRepository(context.scanContext),
        )
      ).value,
    state,
  );
  if (jsFrameworksGate !== undefined && state.hasJavaScriptTooling) {
    state.hasJavaScriptFrameworks = jsFrameworksGate;
  } else if (!state.hasJavaScriptTooling) {
    state.hasJavaScriptFrameworks = false;
  }

  const rustGate = await evaluateGate(
    "hasRust",
    [() => quickTestRust(context)],
    async () => (await timedGate("rust", () => looksLikeRustRepository(context.scanContext))).value,
    state,
  );
  if (rustGate !== undefined) {
    state.hasRust = rustGate;
  }

  if (!state.hasJavaScriptTooling) {
    observability.derivedFalse.push(
      ...[
        "hasJavaScriptLinting",
        "hasJavaScriptBuildConfig",
        "hasJavaScriptPackageScripts",
        "hasJavaScriptFrameworks",
      ].map((gate) => ({ gate, dueTo: ["hasJavaScriptTooling"] })),
    );
  }

  for (const gate of ["hasJavaScriptTooling", "hasJavaScriptFrameworks", "hasRust"] as const) {
    if (state[gate]) {
      observability.observed.push(gate);
    }
  }

  return { state, observability };
}

async function evaluateGate(
  key: GateKey,
  quickTests: (() => boolean | undefined)[],
  expensiveEval: () => Promise<boolean>,
  state: RepositoryDiagnosticGateState,
): Promise<boolean | undefined> {
  const prereqs = gatePrerequisites[key];
  if (prereqs) {
    for (const prereq of prereqs) {
      if (!state[prereq]) {
        return false;
      }
    }
  }

  for (const test of quickTests) {
    const result = test();
    if (result !== undefined) {
      return result;
    }
  }

  return expensiveEval();
}
