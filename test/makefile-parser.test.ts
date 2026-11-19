import { testTempRoot } from "./temp-root.ts";
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateRules, type RuleContext } from "../src/rule-engine.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { parseWorkflow } from "../src/workflow.ts";
import type { RepositorySignals } from "../src/repository-signals-types.ts";
import {
  parseMakefile,
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
      blobNoneCheckouts: [],
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
        blobNoneCheckouts: new Map(),
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
      hasOxlintTypeAwareBackend: false,
    },
    prettier: {
      usesPrettier: false,
      usesOxfmt: false,
      usesBunFmt: false,
      hasConfig: false,
      pluginNames: [],
      usesPrettierEslint: false,
    },
    python: {
      usesBlack: false,
      usesIsort: false,
      usesRuff: false,
      usesTox: false,
      usesNox: false,
      versionOccurrences: [],
    },
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
      testWorkerTuningConfigured: {},
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
    jvm: {
      usesJvm: false,
      usesJava: false,
      usesKotlin: false,
      usesScala: false,
      usesGroovy: false,
      usesSpringBoot: false,
      usesMaven: false,
      usesGradle: false,
    },
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

      const recipes = collectRecipeChain("gotest", parsed);
      expect(recipes.length).toBeGreaterThan(0);

      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match).not.toBeNull();
      expect(match!.tool).toBe("go test");
      expect(match!.category).toBe("Go");
    });

    test("detects direct go test in recipe", () => {
      const parsed = parseMakefile("test:\n\tgo test -race ./...\n");
      const recipes = collectRecipeChain("test", parsed);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match).not.toBeNull();
      expect(match!.tool).toBe("go test");
    });

    test("detects cargo test in recipe", () => {
      const parsed = parseMakefile("check:\n\tcargo test --all\n");
      const recipes = collectRecipeChain("check", parsed);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match).not.toBeNull();
      expect(match!.tool).toBe("cargo");
    });

    test("does not trigger for unknown tool", () => {
      const parsed = parseMakefile("build:\n\tgcc -o output *.c\n");
      const recipes = collectRecipeChain("build", parsed);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match).toBeNull();
    });
  });

  describe("integration with rule engine", () => {
    test("suppresses missing-make-j-flag when make target uses go test", async () => {
      const tmpDir = await mkdtemp(path.join(testTempRoot(), "apl-make-go-"));
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
      const tmpDir = await mkdtemp(path.join(testTempRoot(), "apl-make-cc-"));
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
      const tmpDir = await mkdtemp(path.join(testTempRoot(), "apl-make-nomf-"));
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

  describe("wrapper makefiles and alias chains (iyi shape)", () => {
    test("follows prerequisite aliases to a wrapper recipe", () => {
      const parsed = parseMakefile(
        [
          "all: app",
          "app: .build/app",
          ".build/app:",
          "\t$(EXPORTS) cargo build --release",
          "",
        ].join("\n"),
      );
      const recipes = collectRecipeChain("all", parsed);
      expect(recipes.length).toBe(1);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match?.tool).toBe("cargo");
    });

    test("aliases expression target keys to expanded names", () => {
      const parsed = parseMakefile(
        [
          "O := .build",
          "CRYSTAL_BIN := crystal",
          "",
          "crystal: $(O)/$(CRYSTAL_BIN) ## Build the compiler",
          "",
          "$(O)/$(CRYSTAL_BIN): $(DEPS)",
          "\t$(EXPORTS) ./bin/crystal build src/compiler/crystal.cr",
          "",
        ].join("\n"),
      );
      expect(parsed.prereqs.get("crystal")).toEqual(["$(O)/$(CRYSTAL_BIN)"]);
      const recipes = collectRecipeChain("crystal", parsed);
      expect(recipes.length).toBe(1);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match?.tool).toBe("crystal build");
      expect(match?.category).toBe("Crystal");
    });

    test("walks prerequisite builds behind a runner recipe", () => {
      const parsed = parseMakefile(
        [
          "O := .build",
          "EXE :=",
          "",
          "compiler_spec: $(O)/compiler_spec$(EXE)",
          "\t$(O)/compiler_spec$(EXE) $(SPEC_FLAGS)",
          "",
          "$(O)/compiler_spec$(EXE): $(DEPS)",
          "\t$(EXPORT_CC) ./bin/crystal build -o $@ spec/compiler_spec.cr",
          "",
        ].join("\n"),
      );
      const recipes = collectRecipeChain("compiler_spec", parsed);
      expect(recipes.length).toBe(2);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match?.tool).toBe("crystal build");
    });

    test("normalizes windows backslash targets and recipes", () => {
      const parsed = parseMakefile(
        [
          "O := .build",
          "",
          "crystal: $(O)\\crystal.exe",
          "",
          "$(O)\\crystal.exe:",
          "\t.\\bin\\crystal build -o $@ src\\compiler\\crystal.cr",
          "",
        ].join("\n"),
      );
      expect(parsed.prereqs.get("crystal")).toEqual(["$(O)/crystal.exe"]);
      const recipes = collectRecipeChain("crystal", parsed);
      expect(recipes.length).toBe(1);
      const match = detectInternalParallelTool(recipes, parsed.variables);
      expect(match?.tool).toBe("crystal build");
    });

    test("suppresses missing-make-j-flag for a root-level wrapper target", async () => {
      const tmpDir = await mkdtemp(path.join(testTempRoot(), "apl-make-wrapper-"));
      const workflowDir = path.join(tmpDir, ".github/workflows");
      await mkdir(workflowDir, { recursive: true });

      await writeFile(
        path.join(tmpDir, "Makefile"),
        [
          "O := .build",
          "CRYSTAL_BIN := crystal",
          "",
          "crystal: $(O)/$(CRYSTAL_BIN)",
          "",
          "$(O)/$(CRYSTAL_BIN):",
          "\t$(EXPORTS) ./bin/crystal build src/compiler/crystal.cr",
          "",
        ].join("\n"),
      );

      const yaml = [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: make crystal",
      ].join("\n");

      const filePath = path.join(workflowDir, "test.yml");
      await writeFile(filePath, yaml);
      const workflow = parseWorkflow(filePath, tmpDir, yaml);
      const context: RuleContext = {
        repository: createSignals(),
        scanContext: new RepositoryScanContext(tmpDir, []),
      };
      const result = await evaluateRules(workflow, context);
      expect(result.filter((d) => d.ruleId === "missing-make-j-flag")).toHaveLength(0);

      await rm(tmpDir, { recursive: true, force: true });
    });

    test("suppresses missing-make-j-flag for a -f makefile with wrapper targets", async () => {
      const tmpDir = await mkdtemp(path.join(testTempRoot(), "apl-make-f-"));
      const workflowDir = path.join(tmpDir, ".github/workflows");
      await mkdir(workflowDir, { recursive: true });

      await writeFile(
        path.join(tmpDir, "Makefile.win"),
        [
          "O := .build",
          "",
          "crystal: $(O)\\crystal.exe",
          "",
          "$(O)\\crystal.exe:",
          "\t.\\bin\\crystal build -o $@ src\\compiler\\crystal.cr",
          "",
        ].join("\n"),
      );

      const yaml = [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: windows-latest",
        "    steps:",
        "      - run: make -f Makefile.win crystal",
      ].join("\n");

      const filePath = path.join(workflowDir, "test.yml");
      await writeFile(filePath, yaml);
      const workflow = parseWorkflow(filePath, tmpDir, yaml);
      const context: RuleContext = {
        repository: createSignals(),
        scanContext: new RepositoryScanContext(tmpDir, []),
      };
      const result = await evaluateRules(workflow, context);
      expect(result.filter((d) => d.ruleId === "missing-make-j-flag")).toHaveLength(0);

      await rm(tmpDir, { recursive: true, force: true });
    });

    test("keeps the finding for per-file compile makefiles", async () => {
      const tmpDir = await mkdtemp(path.join(testTempRoot(), "apl-make-perfile-"));
      const workflowDir = path.join(tmpDir, ".github/workflows");
      await mkdir(workflowDir, { recursive: true });

      await writeFile(
        path.join(tmpDir, "Makefile"),
        [
          "OBJS = main.o util.o",
          "all: app",
          "app: $(OBJS)",
          "\t$(CC) -o app $(OBJS)",
          "%.o: %.c",
          "\t$(CC) -c $< -o $@",
          "",
        ].join("\n"),
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
      expect(result.filter((d) => d.ruleId === "missing-make-j-flag").length).toBeGreaterThan(0);

      await rm(tmpDir, { recursive: true, force: true });
    });

    test("multi-target invocations stay silent when every target is internally parallel", async () => {
      const tmpDir = await mkdtemp(path.join(testTempRoot(), "apl-make-multi-"));
      const workflowDir = path.join(tmpDir, ".github/workflows");
      await mkdir(workflowDir, { recursive: true });

      await writeFile(
        path.join(tmpDir, "Makefile"),
        [
          "O := .build",
          "",
          "iyi: $(O)/iyi",
          "iyi-daemon: $(O)/iyi-daemon",
          "",
          "$(O)/iyi:",
          "\t$(EXPORTS) ./bin/crystal build -o $@ src/iyi.cr",
          "",
          "$(O)/iyi-daemon:",
          "\t$(EXPORTS) ./bin/crystal build -o $@ src/iyi-daemon.cr",
          "",
        ].join("\n"),
      );

      const yaml = [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: make iyi iyi-daemon",
      ].join("\n");

      const filePath = path.join(workflowDir, "test.yml");
      await writeFile(filePath, yaml);
      const workflow = parseWorkflow(filePath, tmpDir, yaml);
      const context: RuleContext = {
        repository: createSignals(),
        scanContext: new RepositoryScanContext(tmpDir, []),
      };
      const result = await evaluateRules(workflow, context);
      expect(result.filter((d) => d.ruleId === "missing-make-j-flag")).toHaveLength(0);

      await rm(tmpDir, { recursive: true, force: true });
    });
  });
});
