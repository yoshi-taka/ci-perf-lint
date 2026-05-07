import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport, tempDirs } from "./repository-diagnostics-test-helpers.ts";

describe("analyzeRepository repo-aware and tooling rules: supplemental gates", () => {
  test("filters supplemental repository diagnostics by requested finding scope", async () => {
    const workflowOnlyReport = await getFixtureReport(fixtures.barrelFileLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
      workflowOnly: true,
    });
    const repositoryOnlyReport = await getFixtureReport(fixtures.barrelFileLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
      repositoryOnly: true,
    });

    expect(workflowOnlyReport.findings.length).toBeGreaterThan(0);
    expect(workflowOnlyReport.findings.every((finding) => finding.scope !== "repository")).toBe(
      true,
    );
    expect(
      workflowOnlyReport.findings.some(
        (finding) => finding.ruleId === "detected-large-barrel-file",
      ),
    ).toBe(false);

    expect(repositoryOnlyReport.findings.length).toBeGreaterThan(0);
    expect(repositoryOnlyReport.findings.every((finding) => finding.scope === "repository")).toBe(
      true,
    );
    expect(
      repositoryOnlyReport.findings.some(
        (finding) => finding.ruleId === "detected-large-barrel-file",
      ),
    ).toBe(true);
  });

  test("does not run JavaScript supplemental diagnostics without JavaScript-heavy workflows", async () => {
    const fixtureRoot = await tempDirs.create("apl-js-supplemental-gate-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    const srcDir = path.join(fixtureRoot, "src");
    await mkdir(workflowDir, { recursive: true });
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "js-supplemental-gate-fixture" }),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  noop:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo ok",
      ].join("\n"),
    );
    await writeFile(
      path.join(srcDir, "index.js"),
      Array.from({ length: 120 }, (_, index) => `export * from "./m${index + 1}";`).join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
      repositoryOnly: true,
    });

    expect(report.findings.some((finding) => finding.ruleId === "detected-large-barrel-file")).toBe(
      false,
    );
  });

  test("does not run Docker supplemental diagnostics without Docker-heavy workflows", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-supplemental-gate-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  noop:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo ok",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM node:latest", "COPY . .", "RUN npm install"].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "package-lock.json"), "{}\n");

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
      repositoryOnly: true,
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "missing-dockerignore-for-build-context" ||
          finding.ruleId.startsWith("dockerfile-"),
      ),
    ).toBe(false);
  });

  test("ignores experimental artifact dirs at root for large file scan", async () => {
    const fixtureRoot = await tempDirs.create("apl-large-files-ignore-artifact-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "wandb", "run1"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "outputs", "model"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "runs", "run1"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
    );
    const largeFile = "x".repeat(11 * 1024 * 1024);
    await writeFile(path.join(fixtureRoot, "wandb", "run1", "model.bin"), largeFile);
    await writeFile(path.join(fixtureRoot, "outputs", "model", "weights.parquet"), largeFile);
    await writeFile(path.join(fixtureRoot, "runs", "run1", "events.json"), largeFile);

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === "detected-large-files")).toBe(false);
  });

  test("detects large files in subdir runs for large file scan", async () => {
    const fixtureRoot = await tempDirs.create("apl-large-files-subdir-runs-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "src", "runs", "run1"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
    );
    const largeFile = "x".repeat(11 * 1024 * 1024);
    await writeFile(path.join(fixtureRoot, "src", "runs", "run1", "data.parquet"), largeFile);

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((c) => c.ruleId === "detected-large-files");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("src/runs");
  });

  test("reports when Gradle parallel build is not enabled for multi-project", async () => {
    const fixtureRoot = await tempDirs.create("apl-gradle-parallel-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "gradlew"), "");
    await writeFile(path.join(fixtureRoot, "settings.gradle"), 'rootProject.name = "test"');
    await writeFile(path.join(fixtureRoot, "build.gradle"), 'plugins { id("java") }');
    await mkdir(path.join(fixtureRoot, "sub-a"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "sub-a", "build.gradle"), "");
    await mkdir(path.join(fixtureRoot, "sub-b"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "sub-b", "build.gradle"), "");
    await writeFile(
      path.join(fixtureRoot, "gradle.properties"),
      "org.gradle.jvmargs=-Xmx2g",
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
        "      - run: ./gradlew build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (c) => c.ruleId === "gradle-parallel-not-enabled",
    );
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("parallel");
    expect(finding?.scope).toBe("repository");
    expect(finding?.severity).toBe("warning");
  });

  test("skips when gradle.properties has parallel enabled", async () => {
    const fixtureRoot = await tempDirs.create("apl-gradle-parallel-enabled-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "gradlew"), "");
    await writeFile(path.join(fixtureRoot, "build.gradle"), 'plugins { id("java") }');
    await mkdir(path.join(fixtureRoot, "sub"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "sub", "build.gradle"), "");
    await writeFile(
      path.join(fixtureRoot, "gradle.properties"),
      "org.gradle.parallel=true",
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
        "      - run: ./gradlew build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((c) => c.ruleId === "gradle-parallel-not-enabled"),
    ).toBe(false);
  });

  test("skips when CI uses --parallel flag", async () => {
    const fixtureRoot = await tempDirs.create("apl-gradle-parallel-flag-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "gradlew"), "");
    await writeFile(path.join(fixtureRoot, "build.gradle"), 'plugins { id("java") }');
    await mkdir(path.join(fixtureRoot, "sub"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "sub", "build.gradle"), "");
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
        "      - run: ./gradlew build --parallel",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((c) => c.ruleId === "gradle-parallel-not-enabled"),
    ).toBe(false);
  });

  test("skips when only single build file exists", async () => {
    const fixtureRoot = await tempDirs.create("apl-gradle-single-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "gradlew"), "");
    await writeFile(path.join(fixtureRoot, "build.gradle"), 'plugins { id("java") }');
    await writeFile(
      path.join(fixtureRoot, "gradle.properties"),
      "org.gradle.jvmargs=-Xmx2g",
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
        "      - run: ./gradlew build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((c) => c.ruleId === "gradle-parallel-not-enabled"),
    ).toBe(false);
  });
});
