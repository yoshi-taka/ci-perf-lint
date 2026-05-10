import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { evaluateRules, type RuleContext } from "../src/rule-engine.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { parseWorkflow } from "../src/workflow.ts";
import type { RepositorySignals } from "../src/repository-signals-types.ts";
import {
  parseMakefile,
  extractMakeTarget,
  collectRecipeChain,
  detectInternalParallelTool,
} from "../src/rules/shared/makefile-parser.ts";

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
    hatch: { usesHatch: false, usesUvInstaller: false },
    pdm: { usesPdm: false, usesUv: false },
  };
}

describe("makefile-parser", () => {
  describe("parseMakefile", () => {
    test("extracts targets, variables, and includes", () => {
      const source = [
        "GOCMD = go",
        "GOTEST = $(GOCMD) test",
        "include ./Makefile.Common",
        "",
        ".PHONY: test",
        "test:",
        "\t$(GOTEST) -race ./...",
        "",
        ".PHONY: build",
        "build:",
        "\tgo build ./...",
      ].join("\n");

      const result = parseMakefile(source);
      expect(result.targets.has("test")).toBe(true);
      expect(result.targets.has("build")).toBe(true);
      expect(result.targets.get("build")).toContain("go build");
      expect(result.variables.get("GOCMD")).toBe("go");
      expect(result.variables.get("GOTEST")).toBe("$(GOCMD) test");
      expect(result.includes).toContain("./Makefile.Common");
    });
  });

  describe("extractMakeTarget", () => {
    test("extracts target from simple make call", () => {
      expect(extractMakeTarget("make gotest")).toBe("gotest");
    });

    test("extracts target from make -C call", () => {
      expect(extractMakeTarget("make -C collector gotest")).toBe("gotest");
    });

    test("ignores flags", () => {
      expect(extractMakeTarget("make -j gotest")).toBe("gotest");
    });

    test("returns null for bare make", () => {
      expect(extractMakeTarget("make")).toBeNull();
    });
  });

  describe("collectRecipeChain and detectInternalParallelTool", () => {
    test("follows TARGET= variable to find go test chain", () => {
      const makefile = [
        "gotest:",
        '\t@$(MAKE) for-all-target TARGET="test"',
        "",
        "for-all-target: $(GOMODULES)",
        "",
        "$(GOMODULES):",
        "\t$(MAKE) -C $@ $(TARGET)",
        "",
      ].join("\n");

      const common = [
        "GOCMD = go",
        "GOTEST = $(GOCMD) test",
        "GOTEST_OPT = -race -timeout 120s",
        "",
        ".PHONY: test",
        "test:",
        "\t$(GOTEST) $(GOTEST_OPT) ./...",
        "",
      ].join("\n");

      const parsed = parseMakefile(makefile);
      const incParsed = parseMakefile(common);

      for (const [k, v] of incParsed.targets) {
        if (!parsed.targets.has(k)) {
          parsed.targets.set(k, v);
        }
      }
      for (const [k, v] of incParsed.variables) {
        if (!parsed.variables.has(k)) {
          parsed.variables.set(k, v);
        }
      }

      const recipes = collectRecipeChain("gotest", parsed.targets, parsed.variables);
      expect(recipes.length).toBeGreaterThan(0);

      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match).not.toBeNull();
      expect(match!.tool).toBe("go test");
      expect(match!.category).toBe("Go");
    });

    test("detects direct go test in recipe", () => {
      const parsed = parseMakefile("test:\n\tgo test -race ./...\n");
      const recipes = collectRecipeChain("test", parsed.targets, parsed.variables);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match).not.toBeNull();
      expect(match!.tool).toBe("go test");
    });

    test("detects cargo test in recipe", () => {
      const parsed = parseMakefile("check:\n\tcargo test --all\n");
      const recipes = collectRecipeChain("check", parsed.targets, parsed.variables);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match).not.toBeNull();
      expect(match!.tool).toBe("cargo");
    });

    test("does not trigger for unknown tool", () => {
      const parsed = parseMakefile("build:\n\tgcc -o output *.c\n");
      const recipes = collectRecipeChain("build", parsed.targets, parsed.variables);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match).toBeNull();
    });
  });

  describe("integration with rule engine", () => {
    test("suppresses missing-make-j-flag when make target uses go test", async () => {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "apl-make-go-"));
      const workflowDir = path.join(tmpDir, ".github/workflows");
      const collectorDir = path.join(tmpDir, "collector");
      await mkdir(workflowDir, { recursive: true });
      await mkdir(collectorDir, { recursive: true });

      await writeFile(
        path.join(collectorDir, "Makefile"),
        [
          "include ./Makefile.Common",
          "",
          "GOMODULES = ./module1 ./module2",
          "",
          ".PHONY: gotest",
          "gotest:",
          '\t@$(MAKE) for-all-target TARGET="test"',
          "",
          ".PHONY: for-all-target",
          "for-all-target: $(GOMODULES)",
          "",
          "$(GOMODULES):",
          "\t$(MAKE) -C $@ $(TARGET)",
          "",
        ].join("\n"),
      );

      await writeFile(
        path.join(collectorDir, "Makefile.Common"),
        [
          "GOCMD = go",
          "GOTEST = $(GOCMD) test",
          "GOTEST_OPT = -race -timeout 120s",
          "",
          ".PHONY: test",
          "test:",
          "\t$(GOTEST) $(GOTEST_OPT) ./...",
          "",
        ].join("\n"),
      );

      await mkdir(path.join(collectorDir, "module1"));
      await writeFile(
        path.join(collectorDir, "module1", "Makefile"),
        [
          "include ../Makefile.Common",
          "",
          ".PHONY: test",
          "test:",
          "\t$(MAKE) -C ../ test",
          "",
        ].join("\n"),
      );

      const yaml = [
        "name: CI",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: make gotest",
        "        working-directory: collector",
      ].join("\n");

      const filePath = path.join(workflowDir, "test.yml");
      await writeFile(filePath, yaml);
      const workflow = parseWorkflow(filePath, tmpDir, yaml);
      const context: RuleContext = {
        repository: createSignals(),
        scanContext: new RepositoryScanContext(tmpDir, []),
      };
      const result = await evaluateRules(workflow, context);

      const makeFindings = result.filter((d) => d.ruleId === "missing-make-j-flag");
      expect(makeFindings.length).toBe(0);

      await rm(tmpDir, { recursive: true, force: true });
    });

    test("emits finding when make target does not use internal-parallel tool", async () => {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "apl-make-cc-"));
      const workflowDir = path.join(tmpDir, ".github/workflows");
      await mkdir(workflowDir, { recursive: true });

      await writeFile(
        path.join(tmpDir, "Makefile"),
        [".PHONY: all", "all:", "\tgcc -o prog main.c util.c", ""].join("\n"),
      );

      const yaml = [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: make all",
      ].join("\n");

      const filePath = path.join(workflowDir, "test.yml");
      await writeFile(filePath, yaml);
      const workflow = parseWorkflow(filePath, tmpDir, yaml);
      const context: RuleContext = {
        repository: createSignals(),
        scanContext: new RepositoryScanContext(tmpDir, []),
      };
      const result = await evaluateRules(workflow, context);

      const makeFindings = result.filter((d) => d.ruleId === "missing-make-j-flag");
      expect(makeFindings.length).toBeGreaterThan(0);

      await rm(tmpDir, { recursive: true, force: true });
    });

    test("emits finding when Makefile cannot be read", async () => {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "apl-make-nomf-"));
      const workflowDir = path.join(tmpDir, ".github/workflows");
      await mkdir(workflowDir, { recursive: true });

      const yaml = [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: make build",
      ].join("\n");

      const filePath = path.join(workflowDir, "test.yml");
      await writeFile(filePath, yaml);
      const workflow = parseWorkflow(filePath, tmpDir, yaml);
      const context: RuleContext = {
        repository: createSignals(),
        scanContext: new RepositoryScanContext(tmpDir, []),
      };
      const result = await evaluateRules(workflow, context);

      const makeFindings = result.filter((d) => d.ruleId === "missing-make-j-flag");
      expect(makeFindings.length).toBeGreaterThan(0);

      await rm(tmpDir, { recursive: true, force: true });
    });
  });
});
