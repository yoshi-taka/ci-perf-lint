import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport, tempDirs } from "./repository-diagnostics-test-helpers.ts";

describe("analyzeRepository repo-aware and tooling rules: consensus and gates", () => {
  test("deduplicates identical analysis warnings across concurrent repository analyses", async () => {
    const fixtureRoot = await tempDirs.create("apl-concurrent-warning-dedupe-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "package.json"), '{"name":');
    await writeFile(path.join(fixtureRoot, "docker-compose.yml"), "services: [");
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: docker compose -f docker-compose.yml build app",
        "  js:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n"),
    );

    const reports = await Promise.all(
      Array.from({ length: 3 }, () =>
        analyzeRepository({ cwd: fixtureRoot, targetPath: ".", topCount: 20, mode: "exploratory" }),
      ),
    );

    for (const report of reports) {
      const warningKeys = report.analysisWarnings.map(
        (warning) => `${warning.source}\n${warning.message}`,
      );
      expect(new Set(warningKeys).size).toBe(warningKeys.length);
    }
  });

  test("adds similar-workflow consensus context to missing-concurrency", async () => {
    const fixtureRoot = await tempDirs.create("apl-similar-workflow-concurrency-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    const sharedSteps = [
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 20",
      "      - run: npm ci",
      "      - run: npm test",
      "      - run: npm run build",
    ].join("\n");

    for (const fileName of ["release-a.yml", "release-b.yml", "release-c.yml"] as const) {
      await writeFile(
        path.join(workflowDir, fileName),
        [
          `name: ${fileName}`,
          "on:",
          "  pull_request:",
          "concurrency:",
          "  group: ${{ github.workflow }}-${{ github.ref }}",
          "  cancel-in-progress: true",
          "jobs:",
          "  release-check:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          sharedSteps,
        ].join("\n"),
      );
    }

    await writeFile(
      path.join(workflowDir, "release-d.yml"),
      [
        "name: release-d",
        "on:",
        "  pull_request:",
        "jobs:",
        "  release-check:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        sharedSteps,
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-concurrency" &&
        candidate.workflow === ".github/workflows/release-d.yml",
    );
    expect(finding).toBeDefined();
    expect(finding?.location.path).toBe(".github/workflows/release-d.yml");
    expect(finding?.why).toContain("similar workflows already use concurrency");
    expect(finding?.why).toContain("release-a.yml");
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "similar-workflows-missing-concurrency",
      ),
    ).toBe(false);
  });

  test("adds similar-job consensus context to missing-timeout-minutes", async () => {
    const fixtureRoot = await tempDirs.create("apl-similar-workflow-timeout-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    const timedSteps = [
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 20",
      "      - run: npm ci",
      "      - run: npm test",
      "      - run: npm run build",
    ].join("\n");

    for (const fileName of ["ci-a.yml", "ci-b.yml", "ci-c.yml"] as const) {
      await writeFile(
        path.join(workflowDir, fileName),
        [
          `name: ${fileName}`,
          "on:",
          "  pull_request:",
          "jobs:",
          "  release-test:",
          "    runs-on: ubuntu-latest",
          "    timeout-minutes: 20",
          "    steps:",
          timedSteps,
        ].join("\n"),
      );
    }

    await writeFile(
      path.join(workflowDir, "ci-d.yml"),
      [
        "name: ci-d",
        "on:",
        "  pull_request:",
        "jobs:",
        "  release-test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        timedSteps,
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });
    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-timeout-minutes" &&
        candidate.workflow === ".github/workflows/ci-d.yml",
    );
    expect(finding).toBeDefined();
    expect(finding?.workflow).toBe(".github/workflows/ci-d.yml");
    expect(finding?.location.path).toBe(".github/workflows/ci-d.yml");
    expect(finding?.message).toContain('Job "release-test"');
    expect(finding?.why).toContain("similar heavy jobs already define job-level timeout-minutes");
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "similar-workflows-missing-timeout-minutes",
      ),
    ).toBe(false);
  });

  test("adds timeout consensus context even when the repository only has a few workflow files", async () => {
    const fixtureRoot = await tempDirs.create("apl-similar-job-timeout-small-workflow-count-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci-a.yml"),
      [
        "name: ci-a",
        "on:",
        "  pull_request:",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 10",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run lint",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 20",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm test",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 25",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );
    await writeFile(
      path.join(workflowDir, "ci-b.yml"),
      [
        "name: ci-b",
        "on:",
        "  pull_request:",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 10",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run lint",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 20",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm test",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });
    const findings = report.findings.filter(
      (candidate) =>
        candidate.ruleId === "missing-timeout-minutes" &&
        candidate.workflow === ".github/workflows/ci-b.yml",
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.workflow).toBe(".github/workflows/ci-b.yml");
    expect(finding?.message).toContain('Job "build"');
    expect(finding?.why).toContain("similar heavy jobs already define job-level timeout-minutes");
  });

  test("does not add similar-workflow consensus when there are not enough peers", async () => {
    const fixtureRoot = await tempDirs.create("apl-similar-workflow-isolated-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "release-a.yml"),
      [
        "name: release-a",
        "on:",
        "  pull_request:",
        "concurrency:",
        "  group: ${{ github.workflow }}-${{ github.ref }}",
        "  cancel-in-progress: true",
        "jobs:",
        "  release-check:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );
    await writeFile(
      path.join(workflowDir, "release-b.yml"),
      [
        "name: release-b",
        "on:",
        "  pull_request:",
        "concurrency:",
        "  group: ${{ github.workflow }}-${{ github.ref }}",
        "  cancel-in-progress: true",
        "jobs:",
        "  release-check:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );
    await writeFile(
      path.join(workflowDir, "special.yml"),
      [
        "name: special",
        "on:",
        "  pull_request:",
        "jobs:",
        "  custom:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );
    await writeFile(
      path.join(workflowDir, "misc.yml"),
      [
        "name: misc",
        "on:",
        "  workflow_dispatch:",
        "jobs:",
        "  noop:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo ok",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const concurrencyFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-concurrency" &&
        candidate.workflow === ".github/workflows/special.yml",
    );
    expect(concurrencyFinding).toBeDefined();
    expect(concurrencyFinding?.why).not.toContain("similar workflows already use concurrency");
  });

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
});
