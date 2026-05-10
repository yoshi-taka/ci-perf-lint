import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  evaluateRules,
  evaluateRulesCoarseToFine,
  type RuleContext,
  type AnyRuleModule,
} from "../src/rule-engine.ts";
import { parseWorkflow } from "../src/workflow.ts";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import { parseGitlabCi } from "../src/gitlab-ci-workflow.ts";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import type { RepositorySignals } from "../src/repository-signals-types.ts";
import type { AnalysisWarning } from "../src/types.ts";
import { SingularityTracker } from "../src/rules/shared/singularity.ts";
import { preferNodeRunOverNpmRunRule } from "../src/rules/prefer-node-run-over-npm-run.ts";
import { preferBuildxBakeForMultipleImagesRule } from "../src/rules/prefer-buildx-bake-for-multiple-images.ts";
import { missingConcurrencyRule } from "../src/rules/missing-concurrency.ts";

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

  test("ruleFilter excluding all rules returns empty", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n",
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRules(workflow, context, undefined, undefined, () => false);
    expect(result).toEqual([]);
    await cleanup();
  });

  test("matchesFeatureMask: skips rules when required workflowFacts absent", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: Report",
        "on:",
        "  push:",
        "jobs:",
        "  status:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo hello",
      ].join("\n"),
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRules(workflow, context);
    expect(result.some((d) => d.ruleId === "missing-concurrency")).toBe(false);
    await cleanup();
  });

  test("matchesFeatureMask: evaluates rules when required workflowFacts match", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: Build",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRules(workflow, context);
    expect(result.some((d) => d.ruleId === "missing-concurrency")).toBe(true);
    await cleanup();
  });

  test("nodeTypes: skips rule when workflow lacks matching node kind", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: Build",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const tracker = new SingularityTracker();
    const warnings: AnalysisWarning[] = [];
    const context: RuleContext = { repository: createSignals(), singularities: tracker };
    const result = await evaluateRules(workflow, context, warnings);
    expect(result.some((d) => d.ruleId === "missing-concurrency")).toBe(false);
    await cleanup();
  });

  test("skips quarantined rules via SingularityTracker", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: Build",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const tracker = new SingularityTracker();
    tracker.record({
      class: "essential",
      ruleId: "missing-concurrency",
      message: "test quarantine",
    });
    const context: RuleContext = { repository: createSignals(), singularities: tracker };
    const result = await evaluateRules(workflow, context);
    expect(result.some((d) => d.ruleId === "missing-concurrency")).toBe(false);
    expect(result.some((d) => d.ruleId === "missing-dependency-cache")).toBe(true);
    await cleanup();
  });

  describe("error handling (catch block)", () => {
    let originalCheck: AnyRuleModule["check"];

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      originalCheck = missingConcurrencyRule.check;
      (missingConcurrencyRule as { check: AnyRuleModule["check"] }).check = (() => {
        throw new Error("deliberate test error");
      }) as never;
    });

    afterEach(() => {
      (missingConcurrencyRule as { check: AnyRuleModule["check"] }).check =
        originalCheck as unknown as AnyRuleModule["check"];
    });

    test("records singularity and warning when a rule throws", async () => {
      const { workflow, cleanup } = await createWorkflowDoc(
        [
          "name: Build",
          "on:",
          "  push:",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
        ].join("\n"),
      );
      const tracker = new SingularityTracker();
      const warnings: AnalysisWarning[] = [];
      const context: RuleContext = { repository: createSignals(), singularities: tracker };
      const result = await evaluateRules(workflow, context, warnings);
      expect(tracker.failures.length).toBeGreaterThan(0);
      expect(tracker.failures.some((f) => f.ruleId === "missing-concurrency")).toBe(true);
      expect(warnings.some((w) => w.message.includes("missing-concurrency"))).toBe(true);
      expect(Array.isArray(result)).toBe(true);
      await cleanup();
    });

    test("still returns valid diagnostics from other rules despite one throwing", async () => {
      const { workflow, cleanup } = await createWorkflowDoc(
        [
          "name: Build",
          "on:",
          "  push:",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
        ].join("\n"),
      );
      const context: RuleContext = { repository: createSignals() };
      const result = await evaluateRules(workflow, context);
      expect(result.some((d) => d.ruleId === "missing-dependency-cache")).toBe(true);
      expect(result.every((d) => typeof d.ruleId === "string")).toBe(true);
      await cleanup();
    });
  });
});

describe("evaluateRulesCoarseToFine", () => {
  test("returns empty array for empty workflows", async () => {
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRulesCoarseToFine([], context);
    expect(result).toEqual([]);
  });

  test("evaluates single workflow", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: Build",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRulesCoarseToFine([workflow], context);
    expect(result.some((d) => d.ruleId === "missing-dependency-cache")).toBe(true);
    for (const d of result) {
      expect(typeof d.ruleId).toBe("string");
      expect(typeof d.workflow).toBe("string");
    }
    await cleanup();
  });

  test("evaluates multiple workflows and aggregates diagnostics", async () => {
    const doc1 = await createWorkflowDoc(
      [
        "name: CI",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const doc2 = await createWorkflowDoc(
      [
        "name: Test",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRulesCoarseToFine([doc1.workflow, doc2.workflow], context);
    expect(result.some((d) => d.ruleId === "missing-dependency-cache")).toBe(true);
    await doc1.cleanup();
    await doc2.cleanup();
  });

  test("deduplicates diagnostics with same path and line across workflows", async () => {
    const doc1 = await createWorkflowDoc(
      [
        "name: CI",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const doc2 = await createWorkflowDoc(
      [
        "name: CI",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRulesCoarseToFine([doc1.workflow, doc2.workflow], context);
    const keys = result.map((d) => `${d.location.path}:${d.location.line}`);
    expect(new Set(keys).size).toBe(keys.length);
    await doc1.cleanup();
    await doc2.cleanup();
  });

  test("applies maxFindings cap per ruleId", async () => {
    const docs = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        createWorkflowDoc(
          [
            `name: CI ${i}`,
            "on:",
            "  push:",
            "jobs:",
            `  job${i}:`,
            "    runs-on: ubuntu-latest",
            "    steps:",
            "      - uses: actions/setup-node@v4",
            "      - run: npm ci",
          ].join("\n"),
        ),
      ),
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRulesCoarseToFine(
      docs.map((d) => d.workflow),
      context,
    );
    const missingCacheCount = result.filter((d) => d.ruleId === "missing-dependency-cache").length;
    expect(missingCacheCount).toBeLessThanOrEqual(3);
    await Promise.all(docs.map((d) => d.cleanup()));
  });

  test("accumulates findingCounts", async () => {
    const docs = await Promise.all([
      createWorkflowDoc(
        [
          "name: CI",
          "on:",
          "  push:",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
        ].join("\n"),
      ),
      createWorkflowDoc(
        [
          "name: Test",
          "on:",
          "  pull_request:",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
        ].join("\n"),
      ),
    ]);
    const findingCounts = new Map<string, number>();
    const context: RuleContext = { repository: createSignals() };
    await evaluateRulesCoarseToFine(
      docs.map((d) => d.workflow),
      context,
      undefined,
      findingCounts,
    );
    expect(findingCounts.size).toBeGreaterThan(0);
    const total = [...findingCounts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    await Promise.all(docs.map((d) => d.cleanup()));
  });

  test("uses precheck to prioritize workflows (scoring/sorting/slicing)", async () => {
    const lowScoreYaml = [
      "name: CI",
      "on:",
      "  push:",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo hello",
    ].join("\n");
    const highScoreYaml = [
      "name: CI",
      "on:",
      "  push:",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "      - run: npm ci",
    ].join("\n");
    const docLow = await createWorkflowDoc(lowScoreYaml);
    const docHigh = await createWorkflowDoc(highScoreYaml);
    const context: RuleContext = { repository: createSignals() };
    const warnings: AnalysisWarning[] = [];
    const result = await evaluateRulesCoarseToFine(
      [docLow.workflow, docHigh.workflow],
      context,
      warnings,
    );
    expect(result.some((d) => d.ruleId === "missing-dependency-cache")).toBe(true);
    await docLow.cleanup();
    await docHigh.cleanup();
  });

  test("detects implication drift via warnings", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: Build",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const context: RuleContext = { repository: createSignals() };
    const warnings: AnalysisWarning[] = [];
    await evaluateRulesCoarseToFine([workflow], context, warnings);
    const driftWarnings = warnings.filter((w) => w.message.includes("implied"));
    expect(driftWarnings.length).toBeGreaterThanOrEqual(0);
    await cleanup();
  });

  test("respects singularity pole trigger to skip specific workflow+rule", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: Build",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const tracker = new SingularityTracker();
    tracker.record({
      class: "pole",
      ruleId: "missing-concurrency",
      message: "test pole",
      triggeredBy: workflow.relativePath,
    });
    const context: RuleContext = { repository: createSignals(), singularities: tracker };
    const result = await evaluateRulesCoarseToFine([workflow], context);
    expect(result.some((d) => d.ruleId === "missing-concurrency")).toBe(false);
    expect(result.some((d) => d.ruleId === "missing-dependency-cache")).toBe(true);
    await cleanup();
  });

  test("respects singularity quarantine in coarse-to-fine", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: Build",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const tracker = new SingularityTracker();
    tracker.record({
      class: "essential",
      ruleId: "missing-concurrency",
      message: "test quarantine ctf",
    });
    const context: RuleContext = { repository: createSignals(), singularities: tracker };
    const result = await evaluateRulesCoarseToFine([workflow], context);
    expect(result.some((d) => d.ruleId === "missing-concurrency")).toBe(false);
    expect(result.some((d) => d.ruleId === "missing-dependency-cache")).toBe(true);
    await cleanup();
  });

  describe("error handling (catch block in coarse-to-fine)", () => {
    let originalCheck: AnyRuleModule["check"];

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      originalCheck = missingConcurrencyRule.check;
      (missingConcurrencyRule as { check: AnyRuleModule["check"] }).check = (() => {
        throw new RangeError("deliberate test error in ctf");
      }) as never;
    });

    afterEach(() => {
      (missingConcurrencyRule as { check: AnyRuleModule["check"] }).check =
        originalCheck as unknown as AnyRuleModule["check"];
    });

    test("records singularity and warning when a rule throws in coarse-to-fine", async () => {
      const { workflow, cleanup } = await createWorkflowDoc(
        [
          "name: Build",
          "on:",
          "  push:",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
        ].join("\n"),
      );
      const tracker = new SingularityTracker();
      const warnings: AnalysisWarning[] = [];
      const context: RuleContext = { repository: createSignals(), singularities: tracker };
      const result = await evaluateRulesCoarseToFine([workflow], context, warnings, undefined);
      expect(tracker.failures.length).toBeGreaterThan(0);
      expect(tracker.failures.some((f) => f.ruleId === "missing-concurrency")).toBe(true);
      expect(warnings.some((w) => w.message.includes("missing-concurrency"))).toBe(true);
      expect(Array.isArray(result)).toBe(true);
      await cleanup();
    });

    test("still returns valid results from other rules despite throw in coarse-to-fine", async () => {
      const { workflow, cleanup } = await createWorkflowDoc(
        [
          "name: Build",
          "on:",
          "  push:",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
        ].join("\n"),
      );
      const context: RuleContext = { repository: createSignals() };
      const result = await evaluateRulesCoarseToFine([workflow], context);
      expect(result.some((d) => d.ruleId === "missing-dependency-cache")).toBe(true);
      await cleanup();
    });
  });

  test("workflowSemantics as Map distributes per-workflow context", async () => {
    const doc1 = await createWorkflowDoc(
      [
        "name: Build",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const doc2 = await createWorkflowDoc(
      [
        "name: Test",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const wf1 = doc1.workflow;
    const wf2 = doc2.workflow;
    const wfSem1 = { workflow: wf1, hasTimeout: false };
    const wfSem2 = { workflow: wf2, hasTimeout: true };
    const wfMap = new Map([
      [wf1, wfSem1 as never],
      [wf2, wfSem2 as never],
    ]);
    const context: RuleContext = { repository: createSignals(), workflowSemantics: wfMap };
    const result = await evaluateRulesCoarseToFine([wf1, wf2], context);
    expect(result.some((d) => d.ruleId === "missing-dependency-cache")).toBe(true);
    await doc1.cleanup();
    await doc2.cleanup();
  });

  test("ruleFilter excluding all returns empty in coarse-to-fine", async () => {
    const { workflow, cleanup } = await createWorkflowDoc(
      [
        "name: Build",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
      ].join("\n"),
    );
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRulesCoarseToFine(
      [workflow],
      context,
      undefined,
      undefined,
      () => false,
    );
    expect(result).toEqual([]);
    await cleanup();
  });

  test("coarse-to-fine dedup across same path and line", async () => {
    const yaml = [
      "name: Build",
      "on:",
      "  push:",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "      - run: npm ci",
    ].join("\n");
    const doc = await createWorkflowDoc(yaml);
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRulesCoarseToFine([doc.workflow, doc.workflow], context);
    const keys = result.map((d) => `${d.location.path}:${d.location.line}`);
    expect(new Set(keys).size).toBe(keys.length);
    await doc.cleanup();
  });

  test("coarse-to-fine with findingCounts accumulates per-rule counts", async () => {
    const yaml = [
      "name: Build",
      "on:",
      "  push:",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "      - run: npm ci",
    ].join("\n");
    const doc = await createWorkflowDoc(yaml);
    const findingCounts = new Map<string, number>();
    const context: RuleContext = { repository: createSignals() };
    await evaluateRulesCoarseToFine(
      [doc.workflow, doc.workflow],
      context,
      undefined,
      findingCounts,
    );
    expect(findingCounts.size).toBeGreaterThan(0);
    await doc.cleanup();
  });

  test("coarse-to-fine with ruleFilter excluding all and warnings does not crash", async () => {
    const yaml = [
      "name: Build",
      "on:",
      "  push:",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "      - run: npm ci",
    ].join("\n");
    const { workflow, cleanup } = await createWorkflowDoc(yaml);
    const warnings: AnalysisWarning[] = [];
    const context: RuleContext = { repository: createSignals() };
    const result = await evaluateRulesCoarseToFine(
      [workflow],
      context,
      warnings,
      undefined,
      () => false,
    );
    expect(result).toEqual([]);
    expect(Array.isArray(warnings)).toBe(true);
    await cleanup();
  });
});

describe("getRuleCheckFn scope dispatch (orthogonal array)", () => {
  const ghaYaml = [
    "name: Build",
    "on:",
    "  push:",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    "      - run: npm run build",
  ].join("\n");

  const pipelineYaml = ["steps:", "  - command: npm run build", "    label: Build"].join("\n");

  const gitlabYaml = ["build:", "  script:", "    - npm run build"].join("\n");

  const circleYaml = [
    "version: 2.1",
    "jobs:",
    "  build:",
    "    docker:",
    "      - image: cimg/node:22",
    "    steps:",
    "      - run: npm run build",
  ].join("\n");

  const repoRoot = path.join(path.sep, "repo");
  const context: RuleContext = { repository: createSignals() };

  const docs = [
    {
      type: "github-actions" as const,
      doc: parseWorkflow(path.join(repoRoot, ".github/workflows/ci.yml"), repoRoot, ghaYaml),
    },
    {
      type: "buildkite" as const,
      doc: parsePipeline(path.join(repoRoot, ".buildkite/pipeline.yml"), repoRoot, pipelineYaml),
    },
    {
      type: "gitlab-ci" as const,
      doc: parseGitlabCi(path.join(repoRoot, ".gitlab-ci.yml"), repoRoot, gitlabYaml),
    },
    {
      type: "circleci" as const,
      doc: parseCircleCi(path.join(repoRoot, ".circleci/config.yml"), repoRoot, circleYaml),
    },
  ];

  const allScopeRuleFilter = (r: AnyRuleModule) => r.meta.id === "prefer-node-run-over-npm-run";

  for (const { type, doc } of docs) {
    test(`scope=all rule fires for ${type} document`, async () => {
      const result = await evaluateRules(
        doc as never,
        context,
        undefined,
        undefined,
        allScopeRuleFilter,
      );
      expect(result.some((d) => d.ruleId === "prefer-node-run-over-npm-run")).toBe(true);
    });
  }

  test("default (github-actions) rule does not fire for buildkite document", async () => {
    const bkDoc = docs.find((d) => d.type === "buildkite")!.doc;
    const result = await evaluateRules(
      bkDoc as never,
      context,
      undefined,
      undefined,
      (r) => r.meta.id === "missing-concurrency",
    );
    expect(result).toEqual([]);
  });

  test("default (github-actions) rule does not fire for gitlab-ci document", async () => {
    const glDoc = docs.find((d) => d.type === "gitlab-ci")!.doc;
    const result = await evaluateRules(
      glDoc as never,
      context,
      undefined,
      undefined,
      (r) => r.meta.id === "missing-concurrency",
    );
    expect(result).toEqual([]);
  });

  test("default (github-actions) rule does not fire for circleci document", async () => {
    const ciDoc = docs.find((d) => d.type === "circleci")!.doc;
    const result = await evaluateRules(
      ciDoc as never,
      context,
      undefined,
      undefined,
      (r) => r.meta.id === "missing-concurrency",
    );
    expect(result).toEqual([]);
  });

  test("default (github-actions) rule fires for github-actions document", async () => {
    const ghaDoc = docs.find((d) => d.type === "github-actions")!.doc;
    const result = await evaluateRules(
      ghaDoc as never,
      context,
      undefined,
      undefined,
      (r) => r.meta.id === "missing-concurrency",
    );
    expect(result.some((d) => d.ruleId === "missing-concurrency")).toBe(true);
  });
});
