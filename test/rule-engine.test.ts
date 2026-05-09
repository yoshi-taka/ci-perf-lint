import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { evaluateRules, type RuleContext } from "../src/rule-engine.ts";
import { parseWorkflow } from "../src/workflow.ts";
import type { RepositorySignals } from "../src/repository-signals-types.ts";
import type { AnalysisWarning } from "../src/types.ts";
import { preferNodeRunOverNpmRunRule } from "../src/rules/prefer-node-run-over-npm-run.ts";
import { preferBuildxBakeForMultipleImagesRule } from "../src/rules/prefer-buildx-bake-for-multiple-images.ts";

function createSignals(): RepositorySignals {
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
    hatch: {
      usesHatch: false,
      usesUvInstaller: false,
    },
    pdm: {
      usesPdm: false,
      usesUv: false,
    },
    rust: {
      hasCargoToml: false,
      hasWorkspace: false,
      usesNextest: false,
    },
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
    elixir: {
      hasMixExs: false,
      hasToolVersions: false,
    },
  };
}

async function createWorkflowDoc(
  yaml: string,
): Promise<{ workflow: ReturnType<typeof parseWorkflow>; cleanup: () => Promise<void> }> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "apl-rule-engine-"));
  const dir = path.join(tmpDir, ".github/workflows");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "test.yml");
  await writeFile(filePath, yaml);
  const workflow = parseWorkflow(filePath, tmpDir, yaml);
  return {
    workflow,
    cleanup: async () => {
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

describe("evaluateRules", () => {
  test("prefer-node-run-over-npm-run precheck is source-only", () => {
    expect(
      preferNodeRunOverNpmRunRule.meta.precheck({ source: "steps:\n  - run: npm run build\n" }),
    ).toBe(1);
    expect(
      preferNodeRunOverNpmRunRule.meta.precheck({ source: "steps:\n  - run: echo hello\n" }),
    ).toBe(0);
  });

  test("prefer-buildx-bake-for-multiple-images precheck counts repeated builds", () => {
    expect(
      preferBuildxBakeForMultipleImagesRule.meta.precheck({
        source: "- run: docker buildx build a\n- run: docker buildx build b\n",
      }),
    ).toBe(1);
    expect(
      preferBuildxBakeForMultipleImagesRule.meta.precheck({
        source: "- run: docker buildx build a\n",
      }),
    ).toBe(0);
  });

  test("returns diagnostics for a valid workflow", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n",
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRules(workflow, context);
    expect(Array.isArray(result)).toBe(true);
    for (const d of result) {
      expect(typeof d.ruleId).toBe("string");
      expect(["error", "warning", "suggestion"]).toContain(d.severity);
      expect(typeof d.message).toBe("string");
      expect(typeof d.workflow).toBe("string");
      expect(d.location).toHaveProperty("path");
    }
    await cleanup();
  });

  test("accepts warnings parameter without error", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n",
    );
    const context: RuleContext = { repository: createSignals() };
    const warnings: AnalysisWarning[] = [];
    const result = await evaluateRules(workflow, context, warnings);
    expect(Array.isArray(result)).toBe(true);
    expect(Array.isArray(warnings)).toBe(true);
    await cleanup();
  });

  test("produces deterministic results for same input", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n",
    );
    const context: RuleContext = { repository: createSignals() };
    const r1 = await evaluateRules(workflow, context);
    const r2 = await evaluateRules(workflow, context);
    expect(r1.length).toBe(r2.length);
    await cleanup();
  });

  test("handles workflow with empty jobs array", async () => {
    const { workflow, cleanup } = await createWorkflowDoc("name: empty\non: push\njobs: {}\n");
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRules(workflow, context);
    expect(Array.isArray(result)).toBe(true);
    await cleanup();
  });

  test("maxFindings caps total findings per ruleId", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: CI",
        "on: push",
        "jobs:",
        ...[1, 2, 3, 4, 5].flatMap((i) => [
          `  job${i}:`,
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
        ]),
      ].join("\n"),
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRules(workflow, context);
    const missingCacheCount = result.filter((d) => d.ruleId === "missing-dependency-cache").length;
    expect(missingCacheCount).toBeLessThanOrEqual(3);
    await cleanup();
  });

  test("findingCounts accumulates across evaluateRules calls", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n      - run: npm ci\n",
    );
    const findingCounts = new Map<string, number>();
    const context: RuleContext = { repository: createSignals() };
    await evaluateRules(workflow, context, undefined, findingCounts);
    const firstTotal = [...findingCounts.values()].reduce((a, b) => a + b, 0);
    await evaluateRules(workflow, context, undefined, findingCounts);
    const secondTotal = [...findingCounts.values()].reduce((a, b) => a + b, 0);
    expect(secondTotal).toBeGreaterThanOrEqual(firstTotal);
    await cleanup();
  });

  test("ruleFilter restricts which rules run", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npx eslint .\n",
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRules(workflow, context, undefined, undefined, (rule) =>
      rule.meta.id.startsWith("missing-"),
    );
    for (const d of result) {
      expect(d.ruleId.startsWith("missing-")).toBe(true);
    }
    await cleanup();
  });
});
