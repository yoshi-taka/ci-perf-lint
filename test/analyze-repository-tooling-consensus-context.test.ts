import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { getFixtureReport, tempDirs } from "./repository-diagnostics-test-helpers.ts";

describe("analyzeRepository repo-aware and tooling rules: consensus context", () => {
  test("deduplicates identical analysis warnings across concurrent repository analyses", async () => {
    const fixtureRoot = await tempDirs.create("apl-concurrent-warning-dedupe-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "package.json"), '{"name":');
    await writeFile(path.join(fixtureRoot, "docker-compose.yml"), "services: [");

    await Promise.all([
      getFixtureReport(fixtureRoot, { targetPath: ".", topCount: 20, mode: "strict" }),
      getFixtureReport(fixtureRoot, { targetPath: ".", topCount: 20, mode: "strict" }),
    ]);

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const uniqueWarningTexts = new Set(
      report.analysisWarnings.map((w) => `${w.source}:${w.message}`),
    );

    expect(report.analysisWarnings.length).toBe(uniqueWarningTexts.size);
  });

  test("adds similar-workflow consensus context to missing-concurrency", async () => {
    const fixtureRoot = await tempDirs.create("apl-concurrency-consensus-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });

    const concurrencyWorkflow = (name: string) =>
      [
        `name: ${name}`,
        "on:",
        "  pull_request:",
        "concurrency:",
        "  group: ci-${{ github.ref }}",
        "  cancel-in-progress: true",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n");

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-a.yml"),
      concurrencyWorkflow("ci-a"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-b.yml"),
      concurrencyWorkflow("ci-b"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-c.yml"),
      concurrencyWorkflow("ci-c"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-d.yml"),
      [
        "name: ci-d",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
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

    const concurrencyFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-concurrency" &&
        candidate.workflow === ".github/workflows/ci-d.yml",
    );

    expect(concurrencyFinding).toBeDefined();
    expect(concurrencyFinding?.why).toContain("similar workflows already use concurrency");
    expect(concurrencyFinding?.why).toContain(".github/workflows/ci-a.yml");
    expect(concurrencyFinding?.why).toContain(".github/workflows/ci-b.yml");
    expect(concurrencyFinding?.why).toContain(".github/workflows/ci-c.yml");
  });

  test("adds similar-job consensus context to missing-timeout-minutes", async () => {
    const fixtureRoot = await tempDirs.create("apl-timeout-consensus-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });

    const timeoutWorkflow = (name: string) =>
      [
        `name: ${name}`,
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    timeout-minutes: 20",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n");

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-a.yml"),
      timeoutWorkflow("ci-a"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-b.yml"),
      timeoutWorkflow("ci-b"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-c.yml"),
      timeoutWorkflow("ci-c"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-d.yml"),
      [
        "name: ci-d",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
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

    const timeoutFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-timeout-minutes" &&
        candidate.workflow === ".github/workflows/ci-d.yml",
    );

    expect(timeoutFinding).toBeDefined();
    expect(timeoutFinding?.why).toContain("Similar jobs already using timeout-minutes include");
    expect(timeoutFinding?.why).toContain(".github/workflows/ci-a.yml:test");
  });

  test("adds timeout consensus context even when the repository only has a few workflow files", async () => {
    const fixtureRoot = await tempDirs.create("apl-timeout-few-consensus-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "timeout.yml"),
      [
        "name: timeout",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    timeout-minutes: 20",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "notimeout.yml"),
      [
        "name: notimeout",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
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

    const timeoutFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-timeout-minutes" &&
        candidate.workflow === ".github/workflows/notimeout.yml",
    );

    expect(timeoutFinding).toBeDefined();
    expect(timeoutFinding?.why).toContain("already uses job-level timeout-minutes");
    expect(timeoutFinding?.why).toContain(".github/workflows/timeout.yml");
  });

  test("does not add similar-workflow consensus when there are not enough peers", async () => {
    const fixtureRoot = await tempDirs.create("apl-few-peer-consensus-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });

    const concurrencyWorkflow = (name: string) =>
      [
        `name: ${name}`,
        "on:",
        "  pull_request:",
        "concurrency:",
        "  group: ci-${{ github.ref }}",
        "  cancel-in-progress: true",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo build",
      ].join("\n");

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-a.yml"),
      concurrencyWorkflow("ci-a"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "special.yml"),
      [
        "name: special",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo build",
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
});
