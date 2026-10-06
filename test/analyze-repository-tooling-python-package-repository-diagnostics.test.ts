import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport, tempDirs } from "./repository-diagnostics-test-helpers.ts";

describe("analyzeRepository repo-aware and tooling rules: python package diagnostics", () => {
  describe("avoid-mypy-production-bundle", () => {
    test("warns when mypy is in pyproject.toml production dependencies", async () => {
      const report = await getFixtureReport(fixtures.mypyProductionBundleLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "avoid-mypy-production-bundle");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("high");
      expect(finding?.docsPath).toBe("docs/rules/avoid-mypy-production-bundle.md");
      expect(finding?.location.path).toBe("pyproject.toml");
      expect(finding?.message).toContain("mypy is declared in a production dependency section");
      expect(finding?.message).toContain("project");
    });

    test("skips warning when mypy is only in dev dependencies", async () => {
      const report = await getFixtureReport(fixtures.mypyProductionBundleOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "avoid-mypy-production-bundle")).toBe(false);
    });

    test("warns when mypy is in requirements.txt", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-prod-reqs-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "requirements.txt"),
        ["requests", "mypy==1.12.0"].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -r requirements.txt",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "avoid-mypy-production-bundle");
      expect(finding).toBeDefined();
      expect(finding?.location.path).toBe("requirements.txt");
    });

    test("warns when mypy is in setup.py install_requires", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-prod-setuppy-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "setup.py"),
        'from setuptools import setup\nsetup(name="example", install_requires=["requests", "mypy"])\n',
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -e .",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "avoid-mypy-production-bundle");
      expect(finding).toBeDefined();
      expect(finding?.location.path).toBe("setup.py");
    });

    test("warns when mypy is in setup.cfg install_requires", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-prod-setupcfg-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "setup.cfg"),
        [
          "[metadata]",
          "name = example",
          "[options]",
          "install_requires =",
          "    requests",
          "    mypy",
        ].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -e .",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "avoid-mypy-production-bundle");
      expect(finding).toBeDefined();
      expect(finding?.location.path).toBe("setup.cfg");
    });

    test("warns when mypy is in Pipfile packages", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-prod-pipfile-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "Pipfile"),
        ["[packages]", 'mypy = "*"', "", "[dev-packages]", 'pytest = "*"'].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install pipenv",
          "      - run: pipenv install",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "avoid-mypy-production-bundle");
      expect(finding).toBeDefined();
      expect(finding?.location.path).toBe("Pipfile");
    });

    test("warns when mypy is bundled in CDK assets", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-prod-cdk-");
      const cdkOutDir = path.join(fixtureRoot, "cdk.out", "asset123456789abcdef");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      await mkdir(cdkOutDir, { recursive: true });
      await mkdir(workflowDir, { recursive: true });

      await writeFile(path.join(fixtureRoot, "package.json"), '{"name": "test-cdk"}');
      await writeFile(
        path.join(fixtureRoot, "cdk.out", "manifest.json"),
        JSON.stringify({
          version: "18.0.0",
          artifacts: {
            Asset123456789abcdef: {
              type: "aws:cdk:asset",
              path: "asset123456789abcdef",
              id: "Asset123456789abcdef",
              packaging: "zip",
            },
          },
        }),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -r requirements.txt",
          "      - run: pytest",
        ].join("\n"),
      );
      await writeFile(path.join(cdkOutDir, "index.py"), "def handler(): pass");
      await mkdir(path.join(cdkOutDir, "mypy"), { recursive: true });
      await writeFile(path.join(cdkOutDir, "mypy", "__init__.py"), "# mypy package");

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "avoid-mypy-production-bundle");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("high");
      expect(finding?.location.path).toBe("cdk.out/manifest.json");
      expect(finding?.message).toContain("CDK asset");
      expect(finding?.message).toContain("mypy");
    });

    test("skips warning for non-python repos", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-prod-irrelevant-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements.txt"), "mypy==1.12.0\n");
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
          "      - run: npm test",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "avoid-mypy-production-bundle")).toBe(false);
    });
  });

  describe("prefer-mypy-performance-milestone", () => {
    test("warns when mypy is below 1.13 in requirements.txt", async () => {
      const report = await getFixtureReport(fixtures.mypyMilestoneLike, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "prefer-mypy-performance-milestone");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("medium");
      expect(finding?.docsPath).toBe("docs/rules/prefer-mypy-performance-milestone.md");
      expect(finding?.location.path).toBe("requirements.txt");
      expect(finding?.message).toContain("mypy 1.12.0");
      expect(finding?.message).toContain("1.13");
    });

    test("skips warning when mypy is already at a milestone", async () => {
      const report = await getFixtureReport(fixtures.mypyMilestoneOk, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-mypy-performance-milestone")).toBe(
        false,
      );
    });

    test("warns when mypy is below 1.15 in pyproject.toml", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-milestone-115-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ["[project]", 'dependencies = ["mypy>=1.14,<1.15"]'].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -e .",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "prefer-mypy-performance-milestone");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("1.14");
      expect(finding?.message).toContain("1.15");
    });

    test("warns when mypy 1.18.0 is pinned in poetry.lock", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-milestone-1181-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "poetry.lock"),
        [
          "[[package]]",
          'name = "mypy"',
          'version = "1.18.0"',
          "",
          "[[package]]",
          'name = "requests"',
          'version = "2.32.0"',
        ].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install poetry",
          "      - run: poetry install",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "prefer-mypy-performance-milestone");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("1.18.0");
      expect(finding?.message).toContain("1.18.1");
    });

    test("skips warning for non-python repos", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-milestone-irrelevant-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements.txt"), "mypy==1.12.0\n");
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
          "      - run: npm test",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-mypy-performance-milestone")).toBe(
        false,
      );
    });
  });

  describe("prefer-mypy-2-performance-milestone", () => {
    async function reportFor(version: string) {
      const fixtureRoot = await tempDirs.create("apl-mypy-2-milestone-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements-dev.txt"), `mypy==${version}\n`);
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -r requirements-dev.txt",
          "      - run: pytest",
        ].join("\n"),
      );

      return analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });
    }

    test("warns when mypy 2.0 is pinned", async () => {
      const report = await reportFor("2.0.0");

      const finding = report.findings.find(
        (c) => c.ruleId === "prefer-mypy-2-performance-milestone",
      );
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/prefer-mypy-2-performance-milestone.md");
      expect(finding?.location.path).toBe("requirements-dev.txt");
      expect(finding?.message).toContain("2.0.0");
      expect(finding?.message).toContain("2.4");
    });

    test("suggests 2.4 when mypy 2.3 is pinned", async () => {
      const report = await reportFor("2.3.0");

      const finding = report.findings.find(
        (c) => c.ruleId === "prefer-mypy-2-performance-milestone",
      );
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("2.4");
    });

    test("skips when mypy 2.4 is already at the milestone", async () => {
      const report = await reportFor("2.4.0");

      expect(report.findings.some((c) => c.ruleId === "prefer-mypy-2-performance-milestone")).toBe(
        false,
      );
    });

    test("skips when mypy is still on 1.x", async () => {
      const report = await reportFor("1.20.0");

      expect(report.findings.some((c) => c.ruleId === "prefer-mypy-2-performance-milestone")).toBe(
        false,
      );
    });
  });

  describe("consider-mypy-2-upgrade", () => {
    async function reportFor(version: string) {
      const fixtureRoot = await tempDirs.create("apl-mypy-2-upgrade-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements-dev.txt"), `mypy==${version}\n`);
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -r requirements-dev.txt",
          "      - run: pytest",
        ].join("\n"),
      );

      return analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });
    }

    test("suggests a 2.x upgrade when mypy is on 1.x", async () => {
      const report = await reportFor("1.20.0");

      const finding = report.findings.find((c) => c.ruleId === "consider-mypy-2-upgrade");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/consider-mypy-2-upgrade.md");
      expect(finding?.location.path).toBe("requirements-dev.txt");
      expect(finding?.message).toContain("1.20.0");
      expect(finding?.message).toContain("2.x");
      expect(finding?.suggestion).toContain("2.4");
    });

    test("skips when mypy 2.0 is already used", async () => {
      const report = await reportFor("2.0.0");

      expect(report.findings.some((c) => c.ruleId === "consider-mypy-2-upgrade")).toBe(false);
    });
  });

  describe("prefer-mypy-num-workers", () => {
    function ciWorkflow(mypyCommand: string, extraLines: string[] = []): string {
      return [
        "name: CI",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        ...extraLines,
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-python@v5",
        "      - run: pip install -r requirements-dev.txt",
        `      - run: ${mypyCommand}`,
      ].join("\n");
    }

    test("warns when mypy 2.0 runs without parallel workers", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-workers-like-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements-dev.txt"), "mypy==2.0.0\n");
      await writeFile(path.join(workflowDir, "ci.yml"), ciWorkflow("mypy src"));

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "prefer-mypy-num-workers");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/prefer-mypy-num-workers.md");
      expect(finding?.location.path).toBe(".github/workflows/ci.yml");
      expect(finding?.message).toContain("mypy 2.0.0");
      expect(finding?.message).toContain("without parallel workers");
    });

    test("skips when the mypy command passes --num-workers", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-workers-flag-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements-dev.txt"), "mypy==2.0.0\n");
      await writeFile(path.join(workflowDir, "ci.yml"), ciWorkflow("mypy --num-workers 8 src"));

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-mypy-num-workers")).toBe(false);
    });

    test("skips when num_workers is configured", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-workers-config-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements-dev.txt"), "mypy==2.0.0\n");
      await writeFile(path.join(fixtureRoot, "mypy.ini"), "[mypy]\nnum_workers = auto\n");
      await writeFile(path.join(workflowDir, "ci.yml"), ciWorkflow("mypy src"));

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-mypy-num-workers")).toBe(false);
    });

    test("skips when MYPY_NUM_WORKERS is set in the workflow", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-workers-env-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements-dev.txt"), "mypy==2.0.0\n");
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        ciWorkflow("mypy src", ["    env:", "      MYPY_NUM_WORKERS: '8'"]),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-mypy-num-workers")).toBe(false);
    });

    test("skips when mypy is below 2.0", async () => {
      const fixtureRoot = await tempDirs.create("apl-mypy-workers-old-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements-dev.txt"), "mypy==1.12.0\n");
      await writeFile(path.join(workflowDir, "ci.yml"), ciWorkflow("mypy src"));

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-mypy-num-workers")).toBe(false);
    });
  });

  describe("prefer-pydantic-v2", () => {
    test("warns when pydantic v1 is pinned in pyproject.toml", async () => {
      const report = await getFixtureReport(fixtures.preferPydanticV2Like, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "prefer-pydantic-v2");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("high");
      expect(finding?.docsPath).toBe("docs/rules/prefer-pydantic-v2.md");
      expect(finding?.location.path).toBe("pyproject.toml");
      expect(finding?.message).toContain("Pydantic v1 is pinned");
    });

    test("skips warning when pydantic v2 is used", async () => {
      const report = await getFixtureReport(fixtures.preferPydanticV2Ok, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-pydantic-v2")).toBe(false);
    });

    test("warns when pydantic v1 is pinned in requirements.txt", async () => {
      const fixtureRoot = await tempDirs.create("apl-pydantic-v1-reqs-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "requirements.txt"),
        ["requests", "pydantic==1.10.18", "pytest"].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -r requirements.txt",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "prefer-pydantic-v2");
      expect(finding).toBeDefined();
      expect(finding?.location.path).toBe("requirements.txt");
    });

    test("warns when poetry.lock contains pydantic v1", async () => {
      const fixtureRoot = await tempDirs.create("apl-pydantic-v1-poetry-lock-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "poetry.lock"),
        [
          "[[package]]",
          'name = "pydantic"',
          'version = "1.10.18"',
          "",
          "[[package]]",
          'name = "requests"',
          'version = "2.32.0"',
        ].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install poetry",
          "      - run: poetry install",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "prefer-pydantic-v2");
      expect(finding).toBeDefined();
      expect(finding?.location.path).toBe("poetry.lock");
    });

    test("skips warning for non-python repos", async () => {
      const fixtureRoot = await tempDirs.create("apl-pydantic-v1-irrelevant-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements.txt"), "pydantic==1.10.18\n");
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
          "      - run: npm test",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-pydantic-v2")).toBe(false);
    });
  });

  describe("outdated-pydantic-v2", () => {
    test("warns when pyproject constrains pydantic below 2.11", async () => {
      const report = await getFixtureReport(fixtures.outdatedPydanticV2Like, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "outdated-pydantic-v2");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.docsPath).toBe("docs/rules/outdated-pydantic-v2.md");
      expect(finding?.location.path).toBe("pyproject.toml");
      expect(finding?.message).toContain("older than 2.11");
    });

    test("skips when pydantic is at or above 2.11", async () => {
      const report = await getFixtureReport(fixtures.outdatedPydanticV2Ok, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "outdated-pydantic-v2")).toBe(false);
    });

    test("warns when requirements.txt pins pydantic 2.10", async () => {
      const fixtureRoot = await tempDirs.create("apl-pydantic-v2-reqs-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "requirements.txt"),
        ["requests", "pydantic==2.10.6", "pytest"].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -r requirements.txt",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "outdated-pydantic-v2");
      expect(finding).toBeDefined();
      expect(finding?.location.path).toBe("requirements.txt");
    });

    test("warns when poetry.lock pins pydantic below 2.11", async () => {
      const fixtureRoot = await tempDirs.create("apl-pydantic-v2-poetry-lock-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "poetry.lock"),
        [
          "[[package]]",
          'name = "pydantic"',
          'version = "2.10.6"',
          "",
          "[[package]]",
          'name = "requests"',
          'version = "2.32.0"',
        ].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install poetry",
          "      - run: poetry install",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "outdated-pydantic-v2");
      expect(finding).toBeDefined();
      expect(finding?.location.path).toBe("poetry.lock");
    });

    test("skips floor-only and caret ranges that can resolve 2.11", async () => {
      const fixtureRoot = await tempDirs.create("apl-pydantic-v2-flexible-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        [
          "[project]",
          'name = "example"',
          "dependencies = [",
          '  "pydantic>=2.0",',
          '  "pydantic-core>=2.0",',
          "]",
        ].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -e .",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "outdated-pydantic-v2")).toBe(false);
    });

    test("does not flag pydantic v1 constraints", async () => {
      const fixtureRoot = await tempDirs.create("apl-pydantic-v2-v1-only-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ["[project]", 'name = "example"', "dependencies = [", '  "pydantic>=1.10,<2",', "]"].join(
          "\n",
        ),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "      - run: pip install -e .",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "outdated-pydantic-v2")).toBe(false);
      expect(report.findings.some((c) => c.ruleId === "prefer-pydantic-v2")).toBe(true);
    });
  });

  describe("prefer-python-3-11", () => {
    test("warns on setup-python, matrix, and requires-python below 3.11", async () => {
      const report = await getFixtureReport(fixtures.preferPython311Like, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const repositoryFinding = report.findings.find(
        (c) => c.ruleId === "prefer-python-3-11" && c.scope === "repository",
      );
      expect(repositoryFinding).toBeDefined();
      expect(repositoryFinding?.severity).toBe("warning");
      expect(repositoryFinding?.docsPath).toBe("docs/rules/prefer-python-3-11.md");
      expect(repositoryFinding?.location.path).toBe("pyproject.toml");
      expect(repositoryFinding?.message).toContain("below 3.11");

      const workflowFindings = report.findings.filter(
        (c) => c.ruleId === "prefer-python-3-11" && c.scope !== "repository",
      );
      expect(workflowFindings.some((c) => c.message.includes('Job "test"'))).toBe(true);
      expect(workflowFindings.some((c) => c.message.includes('Job "lint"'))).toBe(true);
    });

    test("skips when Python is at or above 3.11", async () => {
      const report = await getFixtureReport(fixtures.preferPython311Ok, {
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-python-3-11")).toBe(false);
    });

    test("warns on .python-version below 3.11", async () => {
      const fixtureRoot = await tempDirs.create("apl-python-311-file-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, ".python-version"), "3.10.13\n");
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "        with:",
          "          python-version-file: .python-version",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find(
        (c) => c.ruleId === "prefer-python-3-11" && c.scope === "repository",
      );
      expect(finding).toBeDefined();
      expect(finding?.location.path).toBe(".python-version");
    });

    test("skips floor-only requires-python", async () => {
      const fixtureRoot = await tempDirs.create("apl-python-311-floor-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ["[project]", 'name = "example"', 'requires-python = ">=3.9"'].join("\n"),
      );
      await writeFile(
        path.join(workflowDir, "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v4",
          "      - uses: actions/setup-python@v5",
          "        with:",
          '          python-version: "3.12"',
          "      - run: pip install -e .",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "prefer-python-3-11")).toBe(false);
    });
  });
});
