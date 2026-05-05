import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { tempDirs } from "./repository-diagnostics-test-helpers.ts";

describe("analyzeRepository repo-aware and tooling rules: python heavy init and pyramid diagnostics", () => {
  describe("python top-level heavy client init diagnostics", () => {
    test("warns on heavy top-level initializers in FastAPI source", async () => {
      const fixtureRoot = await tempDirs.create("apl-python-heavy-init-like-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const srcDir = path.join(fixtureRoot, "src");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ["[project]", 'dependencies = ["fastapi", "sqlalchemy", "openai"]'].join("\n"),
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
      await writeFile(
        path.join(srcDir, "app.py"),
        [
          "from sqlalchemy import create_engine",
          "from openai import OpenAI",
          "from transformers import AutoModel",
          "",
          'engine = create_engine("sqlite:///app.db")',
          "openai_client = OpenAI()",
          'model = AutoModel.from_pretrained("bert-base-uncased")',
          "",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const findings = report.findings.filter(
        (c) => c.ruleId === "python-top-level-heavy-client-init",
      );
      expect(findings.length).toBe(3);
      expect(findings.every((finding) => finding.scope === "repository")).toBe(true);
      expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
      expect(findings[0]?.docsPath).toBe("docs/rules/python-top-level-heavy-client-init.md");
      expect(findings[0]?.location.path).toBe("src/app.py");
    });

    test("skips lambda-oriented source paths when repository has lambda markers", async () => {
      const fixtureRoot = await tempDirs.create("apl-python-heavy-init-lambda-skip-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const lambdaDir = path.join(fixtureRoot, "src", "functions");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(lambdaDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements.txt"), "fastapi\nawslambdaric\n");
      await writeFile(
        path.join(fixtureRoot, "serverless.yml"),
        [
          "service: app",
          "provider:",
          "  name: aws",
          "functions:",
          "  api:",
          "    handler: src/functions/handler.main",
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
          "      - run: pip install -r requirements.txt",
          "      - run: pytest",
        ].join("\n"),
      );
      await writeFile(
        path.join(lambdaDir, "handler.py"),
        [
          "import boto3",
          "",
          's3 = boto3.client("s3")',
          "",
          "def main(event, context):",
          "    return {}",
          "",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "python-top-level-heavy-client-init")).toBe(
        false,
      );
    });

    test("skips excluded directories and non-framework repositories", async () => {
      const fixtureRoot = await tempDirs.create("apl-python-heavy-init-skip-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const scriptsDir = path.join(fixtureRoot, "src", "scripts");
      const srcDir = path.join(fixtureRoot, "src");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(scriptsDir, { recursive: true });
      await mkdir(srcDir, { recursive: true });
      await writeFile(path.join(fixtureRoot, "requirements.txt"), "sqlalchemy\n");
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
      await writeFile(
        path.join(scriptsDir, "seed.py"),
        ['engine = create_engine("sqlite:///seed.db")', ""].join("\n"),
      );
      await writeFile(
        path.join(srcDir, "worker.py"),
        ['engine = create_engine("sqlite:///worker.db")', ""].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "python-top-level-heavy-client-init")).toBe(
        false,
      );
    });

    test("skips placeholders and lightweight proxy wiring", async () => {
      const fixtureRoot = await tempDirs.create("apl-python-heavy-init-placeholder-skip-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const srcDir = path.join(fixtureRoot, "src");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ["[project]", 'dependencies = ["fastapi", "sqlalchemy", "httpx"]'].join("\n"),
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
      await writeFile(
        path.join(srcDir, "app.py"),
        [
          "from typing import TYPE_CHECKING, cast",
          "from werkzeug.local import LocalProxy",
          "",
          "client = None",
          "proxy = LocalProxy(lambda: None)",
          'engine = cast("Engine", None)',
          "",
          "if TYPE_CHECKING:",
          "    from sqlalchemy import create_engine",
          '    typed_engine = create_engine("sqlite:///app.db")',
          "",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "python-top-level-heavy-client-init")).toBe(
        false,
      );
    });

    test("skips broad pipeline and spacy assignments without model-like target names", async () => {
      const fixtureRoot = await tempDirs.create("apl-python-heavy-init-name-skip-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const srcDir = path.join(fixtureRoot, "src");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "pyproject.toml"),
        ["[project]", 'dependencies = ["fastapi", "transformers", "spacy"]'].join("\n"),
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
      await writeFile(
        path.join(srcDir, "app.py"),
        [
          "from transformers import pipeline",
          "import spacy",
          "",
          'tool = pipeline("text-generation")',
          'loader = spacy.load("en_core_web_sm")',
          "",
        ].join("\n"),
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "python-top-level-heavy-client-init")).toBe(
        false,
      );
    });
  });

  describe("pyramid config.scan diagnostics", () => {
    test("warns when config.scan lacks ignore and scan target contains likely non-runtime directories", async () => {
      const fixtureRoot = await tempDirs.create("apl-pyramid-scan-like-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const appDir = path.join(fixtureRoot, "myapp");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(path.join(appDir, "tests"), { recursive: true });
      await mkdir(path.join(appDir, "docs"), { recursive: true });
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
      await writeFile(
        path.join(fixtureRoot, "app.py"),
        "from pyramid.config import Configurator\n\nconfig = Configurator()\nconfig.scan('myapp')\n",
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      const finding = report.findings.find((c) => c.ruleId === "pyramid-config-scan-unrestricted");
      expect(finding).toBeDefined();
      expect(finding?.scope).toBe("repository");
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("medium");
      expect(finding?.docsPath).toBe("docs/rules/pyramid-config-scan-unrestricted.md");
      expect(finding?.location.path).toBe("app.py");
      expect(finding?.message).toContain("config.scan call lacks an ignore filter");
      expect(finding?.message).toContain("tests");
      expect(finding?.message).toContain("docs");
    });

    test("skips warning when config.scan has an ignore filter", async () => {
      const fixtureRoot = await tempDirs.create("apl-pyramid-scan-ignore-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const appDir = path.join(fixtureRoot, "myapp");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(path.join(appDir, "tests"), { recursive: true });
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
      await writeFile(
        path.join(fixtureRoot, "app.py"),
        "from pyramid.config import Configurator\n\nconfig = Configurator()\nconfig.scan('myapp', ignore=['^tests'])\n",
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "pyramid-config-scan-unrestricted")).toBe(
        false,
      );
    });

    test("skips warning when scan target has no likely non-runtime directories", async () => {
      const fixtureRoot = await tempDirs.create("apl-pyramid-scan-clean-");
      const workflowDir = path.join(fixtureRoot, ".github", "workflows");
      const appDir = path.join(fixtureRoot, "myapp");

      await mkdir(workflowDir, { recursive: true });
      await mkdir(path.join(appDir, "models"), { recursive: true });
      await mkdir(path.join(appDir, "views"), { recursive: true });
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
      await writeFile(
        path.join(fixtureRoot, "app.py"),
        "from pyramid.config import Configurator\n\nconfig = Configurator()\nconfig.scan('myapp')\n",
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "pyramid-config-scan-unrestricted")).toBe(
        false,
      );
    });

    test("skips pyramid diagnostics for non-python repos", async () => {
      const fixtureRoot = await tempDirs.create("apl-pyramid-irrelevant-");
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
      await writeFile(
        path.join(fixtureRoot, "app.py"),
        "from pyramid.config import Configurator\n\nconfig = Configurator()\nconfig.scan('myapp')\n",
      );

      const report = await analyzeRepository({
        cwd: fixtureRoot,
        targetPath: ".",
        topCount: 20,
        mode: "strict",
      });

      expect(report.findings.some((c) => c.ruleId === "pyramid-config-scan-unrestricted")).toBe(
        false,
      );
    });
  });
});
