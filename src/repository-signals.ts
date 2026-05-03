import type { AnalysisWarning } from "./types.ts";
import type { RepositorySignals } from "./repository-signals-types.ts";
import {
  collectJobSummaries,
  collectRepositoryPrecedentSignals,
  collectSimilarWorkflowSignals,
} from "./repository-similar-workflows.ts";
import { isHeavyWorkflow } from "./rules/shared/workflows.ts";
import type { WorkflowDocument } from "./workflow.ts";
import { collectFrameworkSignals } from "./repository-framework-signals.ts";
import { collectRepositoryAuxSignals } from "./repository-signals-aux.ts";
import { LruMap, RepositoryScanContext } from "./repository-scan-context.ts";
import {
  collectBabelSignals,
  collectElixirSignals,
  collectEslintSignals,
  collectHatchSignals,
  collectHuskySignals,
  collectJestSignals,
  collectNativePackageSignals,
  collectPdmSignals,
  collectPrettierSignals,
  collectPythonSignals,
  collectRustSignals,
  collectTailwindSignals,
  collectTypeScriptSignals,
} from "./repository-tooling-signals.ts";

const repositorySignalsCache = new LruMap<
  string,
  Promise<{ fingerprint: string; signals: RepositorySignals; warnings: AnalysisWarning[] }>
>(64);

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

function workflowFingerprint(workflows: WorkflowDocument[]): string {
  return JSON.stringify(
    workflows.map((workflow) => [
      workflow.relativePath,
      workflow.source ?? "",
      workflow.jobs.length,
    ]),
  );
}

export async function collectRepositorySignals(
  repoRoot: string,
  workflows: WorkflowDocument[],
  scanContext?: RepositoryScanContext,
): Promise<{ signals: RepositorySignals; warnings: AnalysisWarning[] }> {
  const fingerprint = workflowFingerprint(workflows);
  const cached = repositorySignalsCache.get(repoRoot);
  if (cached) {
    const result = await cached;
    if (result.fingerprint === fingerprint) {
      return {
        signals: result.signals,
        warnings: [...result.warnings],
      };
    }
  }

  const warnings = scanContext?.warnings ?? [];
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings);
  const heavyWorkflowCount = workflows.filter((workflow) => isHeavyWorkflow(workflow)).length;
  const reusableWorkflowJobCount = workflows.reduce(
    (count, workflow) => count + workflow.jobs.filter((job) => job.usesReusableWorkflow).length,
    0,
  );
  async function safeSignal<T>(label: string, collect: () => Promise<T>, fallback: T): Promise<T> {
    const signalStartedAt = performance.now();
    try {
      const value = await collect();
      if (timingsEnabled()) {
        process.stderr.write(
          `[timing] collectRepositorySignals ${label}=${(performance.now() - signalStartedAt).toFixed(1)}ms\n`,
        );
      }
      return value;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push({ source: "collectRepositorySignals", message: `${label} failed: ${detail}` });
      if (timingsEnabled()) {
        process.stderr.write(
          `[timing] collectRepositorySignals ${label}=${(performance.now() - signalStartedAt).toFixed(1)}ms(fallback)\n`,
        );
      }
      return fallback;
    }
  }

  const auxSignals = await safeSignal(
    "repositoryAux",
    () => collectRepositoryAuxSignals(context, workflows),
    {
      compositeActionCount: 0,
      hasMonorepoMarkers: false,
      hasDockerBakeFile: false,
      stackedDiffs: { likelyUsed: false, evidence: [] },
      npm: {
        npmrcFiles: [],
        npmrcRelevantSettings: [],
        lifecycleHookScripts: [],
        packageScriptEnvReferences: [],
        workflowEnvReferences: [],
      },
    },
  );

  const [
    eslintSignals,
    prettierSignals,
    pythonSignals,
    nativePackageSignals,
    pdmSignals,
    frameworkSignals,
    typescriptSignals,
    huskySignals,
    hatchSignals,
    jestSignals,
    tailwindSignals,
    rustSignals,
    babelSignals,
    elixirSignals,
  ] = await Promise.all([
    safeSignal("eslint", () => collectEslintSignals(context), {
      usesEslint: false,
      usesOxlint: false,
      hasConfig: false,
      pluginNames: [],
      unsupportedPluginNames: [],
      usesCustomExtensions: false,
      usesPrettierPlugin: false,
      usesPrettierRecommendedConfig: false,
      usesPrettierRule: false,
      usesImportPlugin: false,
      usesImportXPlugin: false,
      usesNoBarrelFilesPlugin: false,
      usesBarrelFilesPlugin: false,
    }),
    safeSignal("prettier", () => collectPrettierSignals(context), {
      usesPrettier: false,
      usesOxfmt: false,
      hasConfig: false,
      pluginNames: [],
      usesPrettierEslint: false,
    }),
    safeSignal("python", () => collectPythonSignals(context), {
      usesBlack: false,
      usesIsort: false,
      usesRuff: false,
      usesTox: false,
      usesNox: false,
    }),
    safeSignal("nativePackages", () => collectNativePackageSignals(context), {
      node: [],
      python: [],
    }),
    safeSignal("pdm", () => collectPdmSignals(context), {
      usesPdm: false,
      usesUv: false,
    }),
    safeSignal("frameworks", () => collectFrameworkSignals(context), {
      usesNextjs: false,
      usesStorybook: false,
      usesVite: false,
      usesAstro: false,
      usesSvelteKit: false,
      usesSolidStart: false,
      usesTurbo: false,
      usesNx: false,
      usesLerna: false,
      usesGradle: false,
      gradleBuildCacheConfigured: false,
      usesAngularCli: false,
      angularCliCacheEnabledForCi: false,
    }),
    safeSignal("typescript", () => collectTypeScriptSignals(context), {
      versionSpec: undefined,
      major: undefined,
      minor: undefined,
      isPublishingTypeDefinitions: false,
    }),
    safeSignal("husky", () => collectHuskySignals(context), {
      usesHusky: false,
      usesLintStaged: false,
      hookFileCount: 0,
      nonPreCommitHookCount: 0,
      totalHookCommandCount: 0,
      multiCommandHookCount: 0,
      lintStagedPatternCount: 0,
      lintStagedCommandCount: 0,
      hookFiles: [],
    }),
    safeSignal("hatch", () => collectHatchSignals(context), {
      usesHatch: false,
      usesUvInstaller: false,
    }),
    safeSignal("jest", () => collectJestSignals(context), {
      versionSpec: undefined,
      major: undefined,
      minor: undefined,
      jsdomVersionSpec: undefined,
      jsdomMajor: undefined,
      jsdomEnvironmentVersionSpec: undefined,
      jsdomEnvironmentMajor: undefined,
    }),
    safeSignal("tailwind", () => collectTailwindSignals(context), {
      usesTailwind: false,
      hasConfig: false,
      usesConfigPlugins: false,
      usesPostcssPlugin: false,
      usesVitePlugin: false,
      usesCliPackage: false,
      hasLegacyBrowserTargets: false,
    }),
    safeSignal("rust", () => collectRustSignals(context), {
      hasCargoToml: false,
      hasWorkspace: false,
      usesNextest: false,
    }),
    safeSignal("babel", () => collectBabelSignals(context), {
      usesBabel: false,
      hasConfig: false,
      presetNames: [],
      pluginNames: [],
      hasCustomPlugins: false,
      hasMacros: false,
      hasDecorators: false,
      hasEmotionPlugin: false,
      hasStyledComponentsPlugin: false,
      hasRelayPlugin: false,
      hasI18nPlugin: false,
      hasCoreJs: false,
      hasLegacyBrowserTargets: false,
    }),
    safeSignal("elixir", () => collectElixirSignals(context), {
      hasMixExs: false,
      hasToolVersions: false,
    }),
  ]);

  const sharedJobSummaries = collectJobSummaries(workflows);

  const result = {
    fingerprint,
    signals: {
      primaryWorkflowPath: workflows
        .map((workflow) => workflow.relativePath)
        .sort((left, right) => left.localeCompare(right))[0],
      workflowCount: workflows.length,
      heavyWorkflowCount,
      reusableWorkflowJobCount,
      compositeActionCount: auxSignals.compositeActionCount,
      hasMonorepoMarkers: auxSignals.hasMonorepoMarkers,
      looksLargeOrComplex:
        workflows.length >= 10 ||
        heavyWorkflowCount >= 5 ||
        reusableWorkflowJobCount >= 3 ||
        auxSignals.compositeActionCount >= 2 ||
        auxSignals.hasMonorepoMarkers,
      docker: {
        hasBakeFile: auxSignals.hasDockerBakeFile,
      },
      stackedDiffs: auxSignals.stackedDiffs,
      similarWorkflows: collectSimilarWorkflowSignals(workflows, sharedJobSummaries),
      repoPrecedents: collectRepositoryPrecedentSignals(workflows, sharedJobSummaries),
      eslint: eslintSignals,
      prettier: prettierSignals,
      python: pythonSignals,
      nativePackages: nativePackageSignals,
      npm: auxSignals.npm,
      pdm: pdmSignals,
      frameworks: frameworkSignals,
      typescript: typescriptSignals,
      jest: jestSignals,
      tailwind: tailwindSignals,
      husky: huskySignals,
      hatch: hatchSignals,
      rust: rustSignals,
      babel: babelSignals,
      elixir: elixirSignals,
    },
    warnings: [...warnings],
  };
  repositorySignalsCache.set(repoRoot, Promise.resolve(result));
  return {
    signals: result.signals,
    warnings: [...result.warnings],
  };
}
