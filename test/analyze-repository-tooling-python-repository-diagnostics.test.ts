import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { tempDirs } from "./repository-diagnostics-test-helpers.ts";

describe("analyzeRepository repo-aware and tooling rules: python repository diagnostics", () => {
  describe("pytest diagnostics", () => {
    test("warns when async pytest tests instantiate TestClient", async () => {
      const fixtureRoot = await tempDirs.create("apl-async-testclient-like-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const testsDir = path.join(fixtureRoot, "tests");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(testsDir, { recursive: true });
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
          "      - run: pip install pytest fastapi httpx",
          "      - run: pytest",
        ].join("\n"),
      );
      await writeFile(
        path.join(testsDir, "test_api.py"),
        [
          "from fastapi.testclient import TestClient",
          "",
          "async def test_health(app):",
          "    client = TestClient(app)",
          '    assert client.get("/health").status_code == 200',
          "",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "exploratory",
      });

      const finding = report.findings.find((c) => c.ruleId === "async-test-uses-sync-testclient");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("medium");
      expect(finding?.docsPath).toBe("docs/rules/async-test-uses-sync-testclient.md");
      expect(finding?.location.path).toBe("tests/test_api.py");
      expect(finding?.location.line).toBe(4);
      expect(finding?.message).toContain("uses TestClient");
    });

    test("skips sync pytest tests that use TestClient", async () => {
      const fixtureRoot = await tempDirs.create("apl-async-testclient-sync-ok-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const testsDir = path.join(fixtureRoot, "tests");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(testsDir, { recursive: true });
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
          "      - run: pip install pytest fastapi httpx",
          "      - run: pytest",
        ].join("\n"),
      );
      await writeFile(
        path.join(testsDir, "test_api.py"),
        [
          "from fastapi.testclient import TestClient",
          "",
          "def test_health(app):",
          "    client = TestClient(app)",
          '    assert client.get("/health").status_code == 200',
          "",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "exploratory",
      });

      expect(report.findings.some((c) => c.ruleId === "async-test-uses-sync-testclient")).toBe(
        false,
      );
    });

    test("warns when pytest testpaths is not configured", async () => {
      const fixtureRoot = await tempDirs.create("apl-pytest-testpaths-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "pytest.ini"), ["[pytest]", ""].join("\n"));
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
          "      - run: pip install pytest",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "pytest-testpaths-unconfigured");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("high");
      expect(finding?.docsPath).toBe("docs/rules/pytest-testpaths-unconfigured.md");
      expect(finding?.location.path).toBe("pytest.ini");
      expect(finding?.message).toContain("testpaths");
    });

    test("skips testpaths warning when CI passes explicit paths", async () => {
      const fixtureRoot = await tempDirs.create("apl-pytest-ci-paths-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
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
          "      - run: pip install pytest",
          "      - run: pytest tests/",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "pytest-testpaths-unconfigured")).toBe(false);
    });

    test("skips testpaths warning when testpaths is set in pyproject.toml", async () => {
      const fixtureRoot = await tempDirs.create("apl-pytest-pyproject-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ["[tool.pytest.ini_options]", 'testpaths = ["tests"]'].join("\n"),
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
          "      - run: pip install pytest",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "pytest-testpaths-unconfigured")).toBe(false);
    });

    test("warns when norecursedirs is missing default directories that exist in the repo", async () => {
      const fixtureRoot = await tempDirs.create("apl-pytest-norecursedirs-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(path.join(fixtureRoot, "node_modules"), { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pytest.ini"),
        ["[pytest]", "norecursedirs = .git"].join("\n"),
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
          "      - run: pip install pytest",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "exploratory",
      });

      const finding = report.findings.find((c) => c.ruleId === "pytest-norecursedirs-override");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("suggestion");
      expect(finding?.confidence).toBe("high");
      expect(finding?.docsPath).toBe("docs/rules/pytest-norecursedirs-override.md");
      expect(finding?.location.path).toBe("pytest.ini");
      expect(finding?.location.line).toBe(2);
      expect(finding?.message).toContain("node_modules");
    });

    test("skips norecursedirs warning when testpaths is configured", async () => {
      const fixtureRoot = await tempDirs.create("apl-pytest-testpaths-no-norecursedirs-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(path.join(fixtureRoot, "node_modules"), { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pytest.ini"),
        ["[pytest]", "testpaths = tests", "norecursedirs = .git"].join("\n"),
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
          "      - run: pip install pytest",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "exploratory",
      });

      expect(report.findings.some((c) => c.ruleId === "pytest-norecursedirs-override")).toBe(false);
    });

    test("skips all pytest diagnostics for non-pytest repos", async () => {
      const fixtureRoot = await tempDirs.create("apl-pytest-irrelevant-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
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
          "      - uses: actions/setup-node@v4",
          "      - run: npm ci",
          "      - run: npm test",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "exploratory",
      });

      expect(
        report.findings.some(
          (c) =>
            c.ruleId === "pytest-testpaths-unconfigured" ||
            c.ruleId === "pytest-norecursedirs-override",
        ),
      ).toBe(false);
    });

    test("reports when pytest-xdist is installed but not used in CI", async () => {
      const fixtureRoot = await tempDirs.create("apl-pytest-xdist-notused-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(path.join(fixtureRoot, "tests"), { recursive: true });
      for (let i = 0; i < 35; i++) {
        await writeFile(path.join(fixtureRoot, "tests", `test_${i}.py`), "");
      }
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ["[project]", 'dependencies = ["pytest", "pytest-xdist"]'].join("\n"),
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
          "      - run: pip install pytest pytest-xdist",
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
        (c) => c.ruleId === "pytest-xdist-installed-but-not-used",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("pytest-xdist is installed");
    });

    test("skips when pytest-xdist is not installed", async () => {
      const fixtureRoot = await tempDirs.create("apl-pytest-xdist-missing-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(path.join(fixtureRoot, "tests"), { recursive: true });
      for (let i = 0; i < 35; i++) {
        await writeFile(path.join(fixtureRoot, "tests", `test_${i}.py`), "");
      }
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ['dependencies = ["pytest"]'].join("\n"),
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
          "      - run: pip install pytest",
          "      - run: pytest",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "pytest-xdist-installed-but-not-used")).toBe(
        false,
      );
    });

    test("skips when pytest command uses -n auto", async () => {
      const fixtureRoot = await tempDirs.create("apl-pytest-xdist-nflag-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(path.join(fixtureRoot, "tests"), { recursive: true });
      for (let i = 0; i < 35; i++) {
        await writeFile(path.join(fixtureRoot, "tests", `test_${i}.py`), "");
      }
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ["[project]", 'dependencies = ["pytest", "pytest-xdist"]'].join("\n"),
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
          "      - run: pip install pytest pytest-xdist",
          "      - run: pytest -n auto",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "pytest-xdist-installed-but-not-used")).toBe(
        false,
      );
    });
  });
});
