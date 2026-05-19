import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type {
  GateKey,
  GateProofs,
  GateResultRecord,
  RepositoryDiagnosticContext,
  RepositoryDiagnosticGateState,
  RepositoryDiagnosticGateResolution,
} from "./collector-types.ts";
import { topologicalSort } from "../rules/shared/topo-sort.ts";
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

interface AdjacencyList {
  successors: Map<GateKey, readonly GateKey[]>;
  predecessors: Map<GateKey, readonly GateKey[]>;
  roots: readonly GateKey[];
  evaluationOrder: readonly GateKey[];
}

export function buildDag(prerequisites: Partial<Record<GateKey, GateKey[]>>): AdjacencyList {
  const allKeys = new Set<GateKey>([
    ...(Object.keys(prerequisites) as GateKey[]),
    ...Object.values(prerequisites).flatMap((v) => v),
  ]);

  const successors = new Map<GateKey, readonly GateKey[]>();
  const predecessors = new Map<GateKey, readonly GateKey[]>();

  for (const key of allKeys) {
    if (!successors.has(key)) {
      successors.set(key, []);
    }
    if (!predecessors.has(key)) {
      predecessors.set(key, []);
    }
  }

  for (const [key, prereqs] of Object.entries(prerequisites) as [GateKey, GateKey[]][]) {
    for (const prereq of prereqs) {
      const predList = [...(successors.get(prereq) ?? [])];
      if (!predList.includes(key)) {
        predList.push(key);
        successors.set(prereq, predList);
      }

      const succList = [...(predecessors.get(key) ?? [])];
      if (!succList.includes(prereq)) {
        succList.push(prereq);
        predecessors.set(key, succList);
      }
    }
  }

  const roots = [...allKeys].filter((k) => (predecessors.get(k) ?? []).length === 0);
  const topo = topologicalSort(allKeys, successors);

  return { successors, predecessors, roots, evaluationOrder: topo };
}

const gatePrerequisites: Partial<Record<GateKey, GateKey[]>> = {
  hasJavaScriptLinting: ["hasJavaScriptTooling"],
  hasJavaScriptBuildConfig: ["hasJavaScriptTooling"],
  hasJavaScriptPackageScripts: ["hasJavaScriptTooling"],
  hasJavaScriptFrameworks: ["hasJavaScriptTooling"],
};

const dag = buildDag(gatePrerequisites);

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
  hasJvm: false,
};

function skippedGateResult(reason: string) {
  return { status: "skipped" as const, reason };
}

const emptyGateResultRecord: GateResultRecord = {
  hasJavaScriptHeavyWorkflow: skippedGateResult("not evaluated"),
  hasJavaScriptTooling: skippedGateResult("not evaluated"),
  hasJavaScriptLinting: skippedGateResult("not evaluated"),
  hasJavaScriptBuildConfig: skippedGateResult("not evaluated"),
  hasJavaScriptPackageScripts: skippedGateResult("not evaluated"),
  hasDockerHeavyWorkflow: skippedGateResult("not evaluated"),
  hasTerraformHeavyWorkflow: skippedGateResult("not evaluated"),
  hasLargeFiles: skippedGateResult("not evaluated"),
  hasDatadogHeavyWorkflow: skippedGateResult("not evaluated"),
  hasPytest: skippedGateResult("not evaluated"),
  hasPythonHeavyWorkflow: skippedGateResult("not evaluated"),
  hasRenovateConfig: skippedGateResult("not evaluated"),
  hasHusky: skippedGateResult("not evaluated"),
  hasJavaScriptFrameworks: skippedGateResult("not evaluated"),
  hasRust: skippedGateResult("not evaluated"),
  hasCdkManifest: skippedGateResult("not evaluated"),
  hasElixirHeavyWorkflow: skippedGateResult("not evaluated"),
  hasGradle: skippedGateResult("not evaluated"),
  hasJvm: skippedGateResult("not evaluated"),
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

const gates = {
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
  jvm: (s: RepositoryDiagnosticGateState) => s.hasJvm,
} as const;

export const gateKeys = {
  javascriptHeavy: "hasJavaScriptHeavyWorkflow",
  javascriptTooling: "hasJavaScriptTooling",
  javascriptLinting: "hasJavaScriptLinting",
  javascriptBuildConfig: "hasJavaScriptBuildConfig",
  javascriptPackageScripts: "hasJavaScriptPackageScripts",
  dockerHeavy: "hasDockerHeavyWorkflow",
  terraformHeavy: "hasTerraformHeavyWorkflow",
  largeFiles: "hasLargeFiles",
  datadogHeavy: "hasDatadogHeavyWorkflow",
  pytest: "hasPytest",
  pythonHeavy: "hasPythonHeavyWorkflow",
  renovate: "hasRenovateConfig",
  husky: "hasHusky",
  javascriptFrameworks: "hasJavaScriptFrameworks",
  rust: "hasRust",
  cdkManifest: "hasCdkManifest",
  elixirHeavy: "hasElixirHeavyWorkflow",
  gradle: "hasGradle",
  jvm: "hasJvm",
} as const satisfies Record<keyof typeof gates, GateKey>;

export function buildGateProofs(state: RepositoryDiagnosticGateState): GateProofs {
  const proofs: GateProofs = {};
  for (const key of Object.keys(state) as GateKey[]) {
    if (state[key]) {
      (proofs as Record<string, object>)[key] = { __gate: key };
    }
  }
  return proofs;
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
    "vite.config.js",
    "vite.config.ts",
    "vite.config.mjs",
    "vite.config.cjs",
    "rollup.config.js",
    "rollup.config.ts",
    "rollup.config.mjs",
    "rollup.config.cjs",
    "tsup.config.js",
    "tsup.config.ts",
    "tsup.config.mjs",
    "tsup.config.cjs",
    "esbuild.config.js",
    "esbuild.config.ts",
    "esbuild.config.mjs",
    "esbuild.config.cjs",
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

function markResolved<K extends GateKey>(results: GateResultRecord, key: K, value: boolean): void {
  results[key] = { status: "resolved", value };
}

export async function collectRepositoryDiagnosticGateState(
  context: RepositoryDiagnosticContext,
): Promise<RepositoryDiagnosticGateResolution> {
  const state: RepositoryDiagnosticGateState = { ...emptyGateState };
  const results: GateResultRecord = { ...emptyGateResultRecord };
  const observability = {
    observed: [] as string[],
    derivedFalse: [] as { gate: string; dueTo: string[] }[],
  };

  const signalGates = collectSignalGateState(context.featureIndex);
  Object.assign(state, signalGates);
  for (const [key, value] of Object.entries(signalGates) as [GateKey, boolean][]) {
    markResolved(results, key, value);
  }

  const [largeFilesEvidence, pytestEvidence, hasRenovateConfig, hasCdkManifest] = await Promise.all(
    [
      timedGate("large-files", () => repositoryLooksLargeFilesHeavy(context.scanContext)),
      timedGate("pytest", () => repositoryLooksPytestHeavy(context.scanContext, context.workflows)),
      timedGate("renovate", () => repositoryHasRenovateConfig(context.scanContext)),
      timedGate("cdk-manifest", () => repositoryHasCdkManifest(context.scanContext)),
    ],
  );
  state.hasLargeFiles = largeFilesEvidence.value;
  markResolved(results, "hasLargeFiles", largeFilesEvidence.value);
  const pytestGate = meetsMinimum(pytestEvidence, "medium");
  state.hasPytest = pytestGate.value;
  markResolved(results, "hasPytest", pytestGate.value);
  state.hasRenovateConfig = hasRenovateConfig;
  markResolved(results, "hasRenovateConfig", hasRenovateConfig);
  state.hasCdkManifest = hasCdkManifest;
  markResolved(results, "hasCdkManifest", hasCdkManifest);
  observability.observed.push("hasLargeFiles", "hasPytest", "hasRenovateConfig", "hasCdkManifest");

  state.hasHusky = context.repository.husky.hookFileCount > 0;
  markResolved(results, "hasHusky", state.hasHusky);
  state.hasGradle = context.repository.frameworks.usesGradle;
  markResolved(results, "hasGradle", state.hasGradle);
  state.hasJvm = context.repository.jvm.usesJvm;
  markResolved(results, "hasJvm", state.hasJvm);
  observability.observed.push("hasJvm");

  const jsObservations = buildJavaScriptGateObservations(context);

  const jsToolingQuick = quickTestJavaScriptTooling(jsObservations);

  if (jsToolingQuick === true) {
    state.hasJavaScriptTooling = true;
    markResolved(results, "hasJavaScriptTooling", true);
    observability.observed.push("hasJavaScriptTooling");

    const [jsBuildConfigEvidence, jsPackageScriptEvidence] = await Promise.all([
      repositoryHasJavaScriptBuildConfigEvidence(context.scanContext),
      repositoryHasJavaScriptPackageScriptEvidence(context.scanContext),
    ]);
    state.hasJavaScriptLinting = repositoryLikelyUsesJavaScriptLinting(context, jsObservations);
    markResolved(results, "hasJavaScriptLinting", state.hasJavaScriptLinting);
    state.hasJavaScriptBuildConfig =
      repositoryLikelyUsesJavaScriptBuildConfig(jsObservations) || jsBuildConfigEvidence;
    markResolved(results, "hasJavaScriptBuildConfig", state.hasJavaScriptBuildConfig);
    state.hasJavaScriptPackageScripts =
      repositoryLikelyUsesJavaScriptPackageScripts(jsObservations) || jsPackageScriptEvidence;
    markResolved(results, "hasJavaScriptPackageScripts", state.hasJavaScriptPackageScripts);
  } else if (jsToolingQuick === false) {
    state.hasJavaScriptTooling = false;
    markResolved(results, "hasJavaScriptTooling", false);
    state.hasJavaScriptLinting = false;
    state.hasJavaScriptBuildConfig = false;
    state.hasJavaScriptPackageScripts = false;
    state.hasJavaScriptFrameworks = false;
    pruneDescendants(
      gateKeys.javascriptTooling,

      state,
      results,
      gateKeys.javascriptTooling,
      observability,
    );
    await evaluateDescendantsPruned(context, state, results, observability);
    return { state, observability, results };
  } else {
    const jsToolingResult = await timedGate("javascript-tooling", () =>
      looksLikeJavaScriptRepository(context.scanContext),
    );
    state.hasJavaScriptTooling = jsToolingResult.value;
    markResolved(results, "hasJavaScriptTooling", jsToolingResult.value);
    observability.observed.push("hasJavaScriptTooling");

    if (!state.hasJavaScriptTooling) {
      state.hasJavaScriptLinting = false;
      state.hasJavaScriptBuildConfig = false;
      state.hasJavaScriptPackageScripts = false;
      state.hasJavaScriptFrameworks = false;
      pruneDescendants(
        gateKeys.javascriptTooling,
        state,
        results,
        gateKeys.javascriptTooling,
        observability,
      );
      await evaluateDescendantsPruned(context, state, results, observability);
      return { state, observability, results };
    }

    const [jsBuildConfigEvidence, jsPackageScriptEvidence] = await Promise.all([
      repositoryHasJavaScriptBuildConfigEvidence(context.scanContext),
      repositoryHasJavaScriptPackageScriptEvidence(context.scanContext),
    ]);
    state.hasJavaScriptLinting = repositoryLikelyUsesJavaScriptLinting(context, jsObservations);
    markResolved(results, "hasJavaScriptLinting", state.hasJavaScriptLinting);
    state.hasJavaScriptBuildConfig =
      repositoryLikelyUsesJavaScriptBuildConfig(jsObservations) || jsBuildConfigEvidence;
    markResolved(results, "hasJavaScriptBuildConfig", state.hasJavaScriptBuildConfig);
    state.hasJavaScriptPackageScripts =
      repositoryLikelyUsesJavaScriptPackageScripts(jsObservations) || jsPackageScriptEvidence;
    markResolved(results, "hasJavaScriptPackageScripts", state.hasJavaScriptPackageScripts);
  }

  const jsFrameworksQuick = quickTestJavaScriptFrameworks(context, jsObservations);
  if (jsFrameworksQuick !== undefined) {
    state.hasJavaScriptFrameworks = jsFrameworksQuick;
    markResolved(results, "hasJavaScriptFrameworks", jsFrameworksQuick);
    observability.observed.push("hasJavaScriptFrameworks");
    if (!jsFrameworksQuick) {
      pruneDescendants(
        gateKeys.javascriptFrameworks,

        state,
        results,
        gateKeys.javascriptFrameworks,
        observability,
      );
    }
  } else {
    const jsFrameworksResult = await timedGate("javascript-frameworks", () =>
      looksLikeJavaScriptFrameworksRepository(context.scanContext),
    );
    state.hasJavaScriptFrameworks = jsFrameworksResult.value;
    markResolved(results, "hasJavaScriptFrameworks", jsFrameworksResult.value);
    observability.observed.push("hasJavaScriptFrameworks");
    if (!jsFrameworksResult.value) {
      pruneDescendants(
        gateKeys.javascriptFrameworks,

        state,
        results,
        gateKeys.javascriptFrameworks,
        observability,
      );
    }
  }

  const rustQuick = quickTestRust(context);
  if (rustQuick !== undefined) {
    state.hasRust = rustQuick;
    markResolved(results, "hasRust", rustQuick);
    observability.observed.push("hasRust");
  } else {
    const rustResult = await timedGate("rust", () => looksLikeRustRepository(context.scanContext));
    state.hasRust = rustResult.value;
    markResolved(results, "hasRust", rustResult.value);
    observability.observed.push("hasRust");
  }

  return { state, observability, results };
}

async function evaluateDescendantsPruned(
  context: RepositoryDiagnosticContext,
  state: RepositoryDiagnosticGateState,
  results: GateResultRecord,
  observability: { observed: string[]; derivedFalse: { gate: string; dueTo: string[] }[] },
): Promise<void> {
  if (state[gateKeys.rust]) {
    return;
  }

  const rustQuick = quickTestRust(context);
  if (rustQuick !== undefined) {
    state.hasRust = rustQuick;
    markResolved(results, "hasRust", rustQuick);
    observability.observed.push("hasRust");
  } else {
    const rustResult = await timedGate("rust", () => looksLikeRustRepository(context.scanContext));
    state.hasRust = rustResult.value;
    markResolved(results, "hasRust", rustResult.value);
    observability.observed.push("hasRust");
  }
}

function pruneDescendants(
  key: GateKey,
  state: RepositoryDiagnosticGateState,
  results: GateResultRecord,
  reason: GateKey,
  observability: {
    derivedFalse: { gate: string; dueTo: string[] }[];
  },
): void {
  const visited = new Set<GateKey>();
  const stack = [...(dag.successors.get(key) ?? [])];

  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (visited.has(curr)) {
      continue;
    }
    visited.add(curr);

    results[curr] = { status: "skipped", reason: `parent gate ${reason} is not resolved true` };

    if (!state[curr]) {
      const existing = observability.derivedFalse.find((d) => d.gate === curr);
      if (existing) {
        if (!existing.dueTo.includes(key)) {
          existing.dueTo.push(key);
        }
      } else {
        observability.derivedFalse.push({ gate: curr, dueTo: [key] });
      }
    } else {
      state[curr] = false as never;
      const existing = observability.derivedFalse.find((d) => d.gate === curr);
      if (existing) {
        if (!existing.dueTo.includes(reason)) {
          existing.dueTo.push(reason);
        }
      } else {
        observability.derivedFalse.push({ gate: curr, dueTo: [reason] });
      }
      stack.push(...(dag.successors.get(curr) ?? []));
    }
  }
}
