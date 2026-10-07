import type { AnalysisWarning } from "./types.ts";
import type { RepositorySignals } from "./repository-signals-types.ts";
import {
  collectRepositoryPrecedentSignals,
  collectSimilarWorkflowSignals,
} from "./repository-similar-workflows.ts";
import type { JobSummary } from "./repository-similar-workflows-job-summaries.ts";
import { getWorkflowFacts } from "./rules/shared/workflow-analysis.ts";
import { isHeavyWorkflow } from "./rules/shared/workflows.ts";
import type { WorkflowDocument } from "./workflow.ts";
import type { AnyWorkflowDocument } from "./ci-types.ts";
import { hashContent } from "./hash.ts";
import { collectFrameworkSignals } from "./repository-framework-signals.ts";
import { collectRepositoryAuxSignals } from "./repository-signals-aux.ts";
import { RepositoryScanContext } from "./repository-scan-context.ts";
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
import { collectJvmSignals } from "./repository-jvm-signals.ts";

const repositorySignalsCache = new WeakMap<
  RepositoryScanContext,
  {
    fingerprint: string;
    signals: RepositorySignals;
    warnings: AnalysisWarning[];
  }
>();

const eslintEvidenceFiles = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.mjs",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
] as const;

const prettierEvidenceFiles = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
] as const;

const babelEvidenceFiles = [
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.ts",
  "babel.config.json",
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
] as const;

const tailwindEvidenceFiles = [
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  ".browserslistrc",
] as const;

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

function anyWorkflowHasToolFeature(workflows: AnyWorkflowDocument[], feature: string): boolean {
  return workflows.some((wf) => getWorkflowFacts(wf).toolPresence.get(feature) ?? false);
}

function packageJsonTextMentions(packageJsonText: string | undefined, pattern: RegExp): boolean {
  return packageJsonText !== undefined && pattern.test(packageJsonText);
}

async function anyPathExists(
  context: RepositoryScanContext,
  fileNames: readonly string[],
): Promise<boolean> {
  const matches = await Promise.all(
    fileNames.map((fileName) => context.pathExists(context.resolve(fileName))),
  );
  return matches.some(Boolean);
}

async function hasPythonSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasPythonSignal")) {
    return true;
  }

  const candidates = ["pyproject.toml", "tox.ini", "tox.toml", "noxfile.py", "hatch.toml"];

  const matches = await Promise.all(
    candidates.map((file) => context.pathExists(context.resolve(file))),
  );
  return matches.some(Boolean);
}

async function hasRustSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasRustSignal")) {
    return true;
  }

  return context.pathExists(context.resolve("Cargo.toml"));
}

async function hasElixirSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasElixirSignal")) {
    return true;
  }

  const matches = await Promise.all([
    context.pathExists(context.resolve("mix.exs")),
    context.pathExists(context.resolve(".tool-versions")),
  ]);
  return matches.some(Boolean);
}

async function hasJvmSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
): Promise<boolean> {
  if (
    anyWorkflowHasToolFeature(workflows, "hasFrameworkSignal") ||
    workflows.some((workflow) => /\b(?:gradlew?|mvnw?|setup-java)\b/.test(workflow.source ?? ""))
  ) {
    return true;
  }

  const jvmEvidenceFiles = [
    "pom.xml",
    "mvnw",
    "mvnw.cmd",
    "build.gradle",
    "build.gradle.kts",
    "gradlew",
    "gradlew.bat",
    "settings.gradle",
    "settings.gradle.kts",
    "build.sbt",
  ];
  const fileMatches = await Promise.all(
    jvmEvidenceFiles.map((f) => context.pathExists(context.resolve(f))),
  );
  if (fileMatches.some(Boolean)) {
    return true;
  }

  const srcDirMatches = await Promise.all(
    ["src/main/java", "src/test/java", "src/main/kotlin", "src/test/kotlin"].map((d) =>
      context.pathExists(context.resolve(d)),
    ),
  );
  return srcDirMatches.some(Boolean);
}

async function hasNativePackageSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasNativePackageSignal")) {
    return true;
  }

  return context.pathExists(context.resolve("package.json"));
}

async function hasEslintSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
  packageJsonText: string | undefined,
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasEslintSignal")) {
    return true;
  }

  if (
    packageJsonTextMentions(
      packageJsonText,
      /\b(?:eslint|oxlint|eslint-plugin-|eslintConfig|eslint\.config|\.eslintrc)\b/i,
    )
  ) {
    return true;
  }

  return anyPathExists(context, eslintEvidenceFiles);
}

async function hasPrettierSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
  packageJsonText: string | undefined,
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasPrettierSignal")) {
    return true;
  }

  if (
    packageJsonTextMentions(
      packageJsonText,
      /\b(?:prettier|oxfmt|prettier-plugin|prettier-eslint|prettier\.config|\.prettierrc)\b/i,
    )
  ) {
    return true;
  }

  return anyPathExists(context, prettierEvidenceFiles);
}

async function hasFrameworkSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
  packageJsonText: string | undefined,
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasFrameworkSignal")) {
    return true;
  }

  if (
    packageJsonTextMentions(
      packageJsonText,
      /\b(?:next|storybook|vite|astro|sveltekit|solid-start|turbo|nx|lerna|gradle|angular)\b/i,
    )
  ) {
    return true;
  }

  if (await context.pathExists(context.resolve("Gemfile"))) {
    return true;
  }

  if (
    await anyPathExists(context, ["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini"] as const)
  ) {
    return true;
  }

  return context.pathExists(context.resolve("package.json"));
}

async function hasTypeScriptSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
  packageJsonText: string | undefined,
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasTypeScriptSignal")) {
    return true;
  }

  if (packageJsonTextMentions(packageJsonText, /\b(?:typescript|ts-jest|tsx)\b/i)) {
    return true;
  }

  return anyPathExists(context, ["tsconfig.json", "tsconfig.base.json"] as const);
}

async function hasJestSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
  packageJsonText: string | undefined,
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasJestSignal")) {
    return true;
  }

  if (packageJsonTextMentions(packageJsonText, /\b(?:jest|jsdom|jest-environment-jsdom)\b/i)) {
    return true;
  }

  return anyPathExists(context, ["jest.config.js", "jest.config.cjs", "jest.config.ts"] as const);
}

async function hasTailwindSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
  packageJsonText: string | undefined,
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasTailwindSignal")) {
    return true;
  }

  if (packageJsonTextMentions(packageJsonText, /\b(?:tailwind|postcss|browserslist)\b/i)) {
    return true;
  }

  return anyPathExists(context, tailwindEvidenceFiles);
}

async function hasHuskySignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
  packageJsonText: string | undefined,
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasHuskySignal")) {
    return true;
  }

  if (packageJsonTextMentions(packageJsonText, /\b(?:husky|lint-staged)\b/i)) {
    return true;
  }

  return context.pathExists(context.resolve(".husky"));
}

async function hasBabelSignalEvidence(
  context: RepositoryScanContext,
  workflows: AnyWorkflowDocument[],
  packageJsonText: string | undefined,
): Promise<boolean> {
  if (anyWorkflowHasToolFeature(workflows, "hasBabelSignal")) {
    return true;
  }

  if (packageJsonTextMentions(packageJsonText, /\b(?:babel|@babel\/|core-js)\b/i)) {
    return true;
  }

  return anyPathExists(context, babelEvidenceFiles);
}

async function collectSignalIf<T>(
  hasEvidence: boolean,
  id: string,
  context: RepositoryScanContext,
  collect: (ctx: RepositoryScanContext) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!hasEvidence) {
    return fallback;
  }
  const signalStartedAt = performance.now();
  try {
    const value = await collect(context);
    if (timingsEnabled()) {
      process.stderr.write(
        `[timing] collectRepositorySignals ${id}=${(performance.now() - signalStartedAt).toFixed(1)}ms\n`,
      );
    }
    return value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    context.warnings.push({
      kind: "scan-warning",
      source: "collectRepositorySignals",
      message: `${id} failed: ${detail}`,
    });
    if (timingsEnabled()) {
      process.stderr.write(
        `[timing] collectRepositorySignals ${id}=${(performance.now() - signalStartedAt).toFixed(1)}ms(fallback)\n`,
      );
    }
    return fallback;
  }
}

export async function collectRepositorySignals(
  repoRoot: string,
  workflows: WorkflowDocument[],
  sharedJobSummaries: JobSummary[],
  scanContext?: RepositoryScanContext,
  additionalDocuments: AnyWorkflowDocument[] = [],
): Promise<{ signals: RepositorySignals; warnings: AnalysisWarning[] }> {
  const warnings = scanContext?.warnings ?? [];
  const evidenceWorkflows = [
    ...workflows,
    ...additionalDocuments.filter((doc) => doc.kind !== "github-actions"),
  ];
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings);
  const fingerprint = evidenceWorkflows
    .map(
      (workflow) =>
        `${workflow.kind}:${workflow.relativePath}:${hashContent(workflow.source ?? "")}`,
    )
    .join("|");
  const cached = repositorySignalsCache.get(context);
  if (cached?.fingerprint === fingerprint) {
    return { signals: cached.signals, warnings: [...cached.warnings] };
  }
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
      warnings.push({
        kind: "scan-warning",
        source: "collectRepositorySignals",
        message: `${label} failed: ${detail}`,
      });
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

  const packageJsonEntry = await context.loadPackageJson();
  const packageJsonText = packageJsonEntry.text;

  const [
    hasPythonEvidence,
    hasRustEvidence,
    hasElixirEvidence,
    hasNativePackageEvidence,
    hasEslintEvidence,
    hasPrettierEvidence,
    hasFrameworkEvidence,
    hasTypeScriptEvidence,
    hasJestEvidence,
    hasTailwindEvidence,
    hasHuskyEvidence,
    hasBabelEvidence,
    hasJvmEvidence,
  ] = await Promise.all([
    hasPythonSignalEvidence(context, evidenceWorkflows),
    hasRustSignalEvidence(context, evidenceWorkflows),
    hasElixirSignalEvidence(context, evidenceWorkflows),
    hasNativePackageSignalEvidence(context, evidenceWorkflows),
    hasEslintSignalEvidence(context, evidenceWorkflows, packageJsonText),
    hasPrettierSignalEvidence(context, evidenceWorkflows, packageJsonText),
    hasFrameworkSignalEvidence(context, evidenceWorkflows, packageJsonText),
    hasTypeScriptSignalEvidence(context, evidenceWorkflows, packageJsonText),
    hasJestSignalEvidence(context, evidenceWorkflows, packageJsonText),
    hasTailwindSignalEvidence(context, evidenceWorkflows, packageJsonText),
    hasHuskySignalEvidence(context, evidenceWorkflows, packageJsonText),
    hasBabelSignalEvidence(context, evidenceWorkflows, packageJsonText),
    hasJvmSignalEvidence(context, evidenceWorkflows),
  ]);

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
    jvmSignals,
  ] = await Promise.all([
    collectSignalIf(hasEslintEvidence, "eslint", context, collectEslintSignals, {
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
      hasOxlintTsgolint: false,
    }),
    collectSignalIf(hasPrettierEvidence, "prettier", context, collectPrettierSignals, {
      usesPrettier: false,
      usesOxfmt: false,
      hasConfig: false,
      pluginNames: [],
      usesPrettierEslint: false,
    }),
    collectSignalIf(hasPythonEvidence, "python", context, collectPythonSignals, {
      usesBlack: false,
      usesIsort: false,
      usesRuff: false,
      usesTox: false,
      usesNox: false,
      versionOccurrences: [],
    }),
    collectSignalIf(
      hasNativePackageEvidence,
      "nativePackages",
      context,
      collectNativePackageSignals,
      {
        node: [],
        python: [],
      },
    ),
    collectSignalIf(
      hasPythonEvidence,
      "pdm",
      context,
      (ctx) => collectPdmSignals(ctx, evidenceWorkflows),
      {
        usesPdm: false,
        usesUv: false,
      },
    ),
    collectSignalIf(hasFrameworkEvidence, "frameworks", context, collectFrameworkSignals, {
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
      testWorkerTuningConfigured: {},
      usesAngularCli: false,
      angularCliCacheEnabledForCi: false,
      usesRails: false,
      railsVersionSpec: undefined,
      railsMajor: undefined,
      railsMinor: undefined,
      railsPatch: undefined,
      rubyVersionSpec: undefined,
      rubyMajor: undefined,
      rubyMinor: undefined,
    }),
    collectSignalIf(hasTypeScriptEvidence, "typescript", context, collectTypeScriptSignals, {
      versionSpec: undefined,
      major: undefined,
      minor: undefined,
      isPublishingTypeDefinitions: false,
    }),
    collectSignalIf(hasHuskyEvidence, "husky", context, collectHuskySignals, {
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
    collectSignalIf(hasPythonEvidence, "hatch", context, collectHatchSignals, {
      usesHatch: false,
      usesUvInstaller: false,
    }),
    collectSignalIf(hasJestEvidence, "jest", context, collectJestSignals, {
      versionSpec: undefined,
      major: undefined,
      minor: undefined,
      jsdomVersionSpec: undefined,
      jsdomMajor: undefined,
      jsdomEnvironmentVersionSpec: undefined,
      jsdomEnvironmentMajor: undefined,
    }),
    collectSignalIf(hasTailwindEvidence, "tailwind", context, collectTailwindSignals, {
      usesTailwind: false,
      hasConfig: false,
      usesConfigPlugins: false,
      usesPostcssPlugin: false,
      usesVitePlugin: false,
      usesCliPackage: false,
      hasLegacyBrowserTargets: false,
    }),
    collectSignalIf(hasRustEvidence, "rust", context, collectRustSignals, {
      hasCargoToml: false,
      hasWorkspace: false,
      usesNextest: false,
    }),
    collectSignalIf(hasBabelEvidence, "babel", context, collectBabelSignals, {
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
    collectSignalIf(hasElixirEvidence, "elixir", context, collectElixirSignals, {
      hasMixExs: false,
      hasToolVersions: false,
    }),
    collectSignalIf(
      hasJvmEvidence,
      "jvm",
      context,
      (ctx) => collectJvmSignals(ctx, evidenceWorkflows),
      {
        usesJvm: false,
        usesJava: false,
        usesKotlin: false,
        usesScala: false,
        usesGroovy: false,
        usesSpringBoot: false,
        usesMaven: false,
        usesGradle: false,
      },
    ),
  ]);

  const result = {
    signals: {
      primaryWorkflowPath: evidenceWorkflows
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
      frameworks: {
        ...frameworkSignals,
        usesGradle: frameworkSignals.usesGradle || jvmSignals.usesGradle,
      },
      typescript: typescriptSignals,
      jest: jestSignals,
      tailwind: tailwindSignals,
      husky: huskySignals,
      hatch: hatchSignals,
      rust: rustSignals,
      babel: babelSignals,
      elixir: elixirSignals,
      jvm: jvmSignals,
    },
    warnings: [...warnings],
  };
  repositorySignalsCache.set(context, { fingerprint, ...result });
  return {
    signals: result.signals,
    warnings: [...result.warnings],
  };
}
