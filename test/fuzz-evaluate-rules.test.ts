import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import YAML from "yaml";
import { evaluateRules, type RuleContext } from "../src/rule-engine.ts";
import { parseWorkflow } from "../src/workflow.ts";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import { parseGitlabCi } from "../src/gitlab-ci-workflow.ts";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import type { RepositorySignals } from "../src/repository-signals-types.ts";
import { workflowObjArb } from "./arbitraries/github-actions.ts";
import { pipelineObjArb } from "./arbitraries/buildkite.ts";
import { gitlabCiObjArb } from "./arbitraries/gitlab-ci.ts";
import { circleCiObjArb } from "./arbitraries/circleci.ts";

function emptySignals(): RepositorySignals {
  return {
    workflowCount: 1,
    heavyWorkflowCount: 0,
    reusableWorkflowJobCount: 0,
    compositeActionCount: 0,
    hasMonorepoMarkers: false,
    looksLargeOrComplex: false,
    docker: { hasBakeFile: false },
    stackedDiffs: { likelyUsed: false, evidence: [] },
    similarWorkflows: {
      concurrency: [],
      timeoutMinutes: [],
      dependencyCache: [],
      deepCheckout: [],
      pathsFilter: [],
      nonCodeIgnore: [],
      index: {
        concurrency: new Map(),
        timeoutMinutes: new Map(),
        dependencyCache: new Map(),
        deepCheckout: new Map(),
        pathsFilter: new Map(),
        nonCodeIgnore: new Map(),
      },
    },
    repoPrecedents: {
      concurrency: [],
      timeoutMinutes: [],
      dependencyCache: [],
      shallowCheckout: [],
      pathsFilter: [],
      nonCodeIgnore: [],
      setupCache: [],
      releaseDownstreamSuccessGuard: [],
      blobNoneReleaseMetadata: [],
      sparseCheckoutScoped: [],
      throttledHeavySchedule: [],
      lookups: {
        concurrency: new Map(),
        timeoutMinutes: new Map(),
        dependencyCache: new Map(),
        shallowCheckout: new Map(),
        pathsFilter: new Map(),
        nonCodeIgnore: new Map(),
        setupCache: new Map(),
        releaseDownstreamSuccessGuard: new Map(),
        blobNoneReleaseMetadata: new Map(),
        sparseCheckoutScoped: new Map(),
        throttledHeavySchedule: new Map(),
      },
    },
    eslint: {
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
    },
    prettier: {
      usesPrettier: false,
      usesOxfmt: false,
      hasConfig: false,
      pluginNames: [],
      usesPrettierEslint: false,
    },
    python: { usesBlack: false, usesIsort: false, usesRuff: false, usesTox: false, usesNox: false },
    nativePackages: { node: [], python: [] },
    npm: {
      npmrcFiles: [],
      npmrcRelevantSettings: [],
      lifecycleHookScripts: [],
      packageScriptEnvReferences: [],
      workflowEnvReferences: [],
    },
    frameworks: {
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
      usesRails: false,
    },
    typescript: { isPublishingTypeDefinitions: false },
    jest: {},
    tailwind: {
      usesTailwind: false,
      hasConfig: false,
      usesConfigPlugins: false,
      usesPostcssPlugin: false,
      usesVitePlugin: false,
      usesCliPackage: false,
      hasLegacyBrowserTargets: false,
    },
    husky: {
      usesHusky: false,
      usesLintStaged: false,
      hookFileCount: 0,
      nonPreCommitHookCount: 0,
      totalHookCommandCount: 0,
      multiCommandHookCount: 0,
      lintStagedPatternCount: 0,
      lintStagedCommandCount: 0,
      hookFiles: [],
    },
    hatch: { usesHatch: false, usesUvInstaller: false },
    pdm: { usesPdm: false, usesUv: false },
    rust: { hasCargoToml: false, hasWorkspace: false, usesNextest: false },
    babel: {
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
    },
    elixir: { hasMixExs: false, hasToolVersions: false },
  };
}

function validDiagnosticShape(d: unknown): boolean {
  if (typeof d !== "object" || d === null) {
    return false;
  }
  const diag = d as Record<string, unknown>;
  return (
    typeof diag.ruleId === "string" &&
    ["error", "warning", "suggestion"].includes(diag.severity as string) &&
    ["high", "medium"].includes(diag.confidence as string) &&
    typeof diag.message === "string" &&
    typeof diag.workflow === "string" &&
    typeof diag.docsPath === "string" &&
    diag.location !== null &&
    typeof diag.location === "object" &&
    typeof (diag.location as Record<string, unknown>).path === "string"
  );
}

describe("fuzz: evaluateRules", () => {
  test("GitHub Actions: never throws, diagnostics have valid shape", async () => {
    await fc.assert(
      fc.asyncProperty(workflowObjArb, async (workflowObj) => {
        const yamlString = YAML.stringify(workflowObj);
        let doc;
        try {
          doc = parseWorkflow("/fuzz/workflow.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const context: RuleContext = { repository: emptySignals() };
        const diagnostics = await evaluateRules(doc, context);

        expect(Array.isArray(diagnostics)).toBe(true);
        for (const d of diagnostics) {
          expect(validDiagnosticShape(d)).toBe(true);
        }
      }),
      { numRuns: 200, interruptAfterTimeLimit: 20000 },
    );
  }, 30000);

  test("Buildkite: never throws, diagnostics have valid shape", async () => {
    await fc.assert(
      fc.asyncProperty(pipelineObjArb, async (pipelineObj) => {
        const yamlString = YAML.stringify(pipelineObj);
        let doc;
        try {
          doc = parsePipeline("/fuzz/pipeline.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const context: RuleContext = { repository: emptySignals() };
        const diagnostics = await evaluateRules(doc, context);

        expect(Array.isArray(diagnostics)).toBe(true);
        for (const d of diagnostics) {
          expect(validDiagnosticShape(d)).toBe(true);
        }
      }),
      { numRuns: 200, interruptAfterTimeLimit: 20000 },
    );
  }, 30000);

  test("GitLab CI: never throws, diagnostics have valid shape", async () => {
    await fc.assert(
      fc.asyncProperty(gitlabCiObjArb, async (gitlabObj) => {
        const yamlString = YAML.stringify(gitlabObj);
        let doc;
        try {
          doc = parseGitlabCi("/fuzz/.gitlab-ci.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const context: RuleContext = { repository: emptySignals() };
        const diagnostics = await evaluateRules(doc, context);

        expect(Array.isArray(diagnostics)).toBe(true);
        for (const d of diagnostics) {
          expect(validDiagnosticShape(d)).toBe(true);
        }
      }),
      { numRuns: 200, interruptAfterTimeLimit: 20000 },
    );
  }, 30000);

  test("CircleCI: never throws, diagnostics have valid shape", async () => {
    await fc.assert(
      fc.asyncProperty(circleCiObjArb, async (circleObj) => {
        const yamlString = YAML.stringify(circleObj);
        let doc;
        try {
          doc = parseCircleCi("/fuzz/.circleci/config.yml", "/fuzz", yamlString);
        } catch {
          return;
        }

        const context: RuleContext = { repository: emptySignals() };
        const diagnostics = await evaluateRules(doc, context);

        expect(Array.isArray(diagnostics)).toBe(true);
        for (const d of diagnostics) {
          expect(validDiagnosticShape(d)).toBe(true);
        }
      }),
      { numRuns: 200, interruptAfterTimeLimit: 20000 },
    );
  }, 30000);
});
