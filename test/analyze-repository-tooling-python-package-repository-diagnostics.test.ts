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

});
