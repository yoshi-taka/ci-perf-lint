import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

describe("analyzeRepository workflow and execution rules: general", () => {
  test("finds core MVP findings in a sample repository", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 5,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    const missingConcurrencyFinding = report.findings.find(
      (finding) => finding.ruleId === "missing-concurrency",
    );

    expect(report.workflowCount).toBe(2);
    expect(ruleIds).toContain("missing-concurrency");
    expect(ruleIds).toContain("missing-dependency-cache");
    expect(ruleIds).toContain("outdated-setup-action-without-cache");
    expect(ruleIds).toContain("deep-checkout-without-need");
    expect(ruleIds).toContain("missing-path-ignore-for-non-code");
    expect(ruleIds).not.toContain("ungated-heavy-job");
    expect(missingConcurrencyFinding?.docsPath).toBe("docs/rules/missing-concurrency.md");
    expect(missingConcurrencyFinding?.location.line).toBe(4);
  });

  test("analyzes the dd-trace-js workflow fixture", async () => {
    const report = await getFixtureReport(fixtures.ddTrace, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));
    const ungatedCount = report.findings.filter(
      (finding) => finding.ruleId === "ungated-heavy-job",
    ).length;

    expect(report.workflowCount).toBe(27);
    expect(report.findings.length).toBeLessThan(250);
    expect(ruleIds.has("missing-paths-filter")).toBe(true);
    expect(ruleIds.has("missing-concurrency")).toBe(true);
    expect(ruleIds.has("ungated-heavy-job")).toBe(true);
    expect(ungatedCount).toBeLessThan(120);
  });

  test("analyzes the gemini-cli workflow fixture", async () => {
    const report = await getFixtureReport(fixtures.geminiCli, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));
    const concurrencyCount = report.findings.filter(
      (finding) => finding.ruleId === "missing-concurrency",
    ).length;
    const deepCheckoutCount = report.findings.filter(
      (finding) => finding.ruleId === "deep-checkout-without-need",
    ).length;

    expect(report.workflowCount).toBe(45);
    expect(report.findings.length).toBeLessThan(80);
    expect(ruleIds.has("missing-paths-filter")).toBe(true);
    expect(ruleIds.has("missing-concurrency")).toBe(true);
    expect(concurrencyCount).toBeLessThan(10);
    expect(deepCheckoutCount).toBeLessThan(10);
  });

  test("adds Actions priority only to the top three Actions findings", async () => {
    const fixtureRoot = await tempDirs.create("apl-limited-actions-priority-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v2",
        "      - run: npm ci",
        "      - run: npm test",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const scoreByRule = new Map(report.findings.map((finding) => [finding.ruleId, finding.score]));

    expect(scoreByRule.get("missing-concurrency")).toBe(58);
    expect(scoreByRule.get("missing-paths-filter")).toBe(125);
    expect(scoreByRule.get("missing-path-ignore-for-non-code")).toBe(120);
    expect(scoreByRule.get("outdated-setup-action-without-cache")).toBe(115);
  });

  test("accepts a direct workflows directory path", async () => {
    const report = await analyzeRepository({
      cwd: process.cwd(),
      targetPath: path.join(fixtures.geminiCli, ".github", "workflows"),
      topCount: 5,
      mode: "exploratory",
    });

    expect(report.workflowCount).toBe(45);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  test("does not flag schedule-only or tag-only workflows for path filters and branch concurrency", async () => {
    const report = await getFixtureReport(fixtures.iamtrailLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleHits = report.findings.map((finding) => `${finding.workflow}:${finding.ruleId}`);

    expect(report.workflowCount).toBe(2);
    expect(ruleHits).not.toContain(".github/workflows/policy_validation.yml:missing-paths-filter");
    expect(ruleHits).not.toContain(".github/workflows/release.yml:missing-paths-filter");
    expect(ruleHits).not.toContain(".github/workflows/release.yml:missing-concurrency");
  });

  test("does not suggest path filters for meta-check workflows", async () => {
    const report = await getFixtureReport(fixtures.metaCheckLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleHits = report.findings.map((finding) => `${finding.workflow}:${finding.ruleId}`);

    expect(report.workflowCount).toBe(1);
    expect(ruleHits).not.toContain(".github/workflows/lint.yml:missing-paths-filter");
    expect(ruleHits).not.toContain(".github/workflows/lint.yml:missing-path-ignore-for-non-code");
    expect(ruleHits).toContain(".github/workflows/lint.yml:missing-concurrency");
  });

  test("promotes path-filter suggestions in strict mode when no stricter findings exist", async () => {
    const fixtureRoot = await tempDirs.create("apl-strict-path-filter-fallback-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "concurrency:",
        "  group: ci-${{ github.ref }}",
        "  cancel-in-progress: true",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 20",
        "    steps:",
        "      - run: npm ci",
        "      - run: npm test",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) =>
        candidate.ruleId === "missing-paths-filter" ||
        candidate.ruleId === "missing-path-ignore-for-non-code",
    );

    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
  });

  test("keeps path-filter suggestions exploratory-only when strict findings already exist", async () => {
    const fixtureRoot = await tempDirs.create("apl-strict-path-filter-no-fallback-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "concurrency:",
        "  group: ci-${{ github.ref }}",
        "  cancel-in-progress: true",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 20",
        "    steps:",
        "      - uses: actions/setup-node@v2",
        "      - run: npm ci",
        "      - run: npm test",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "outdated-setup-action-without-cache",
      ),
    ).toBe(true);
    expect(report.findings.some((candidate) => candidate.ruleId === "missing-paths-filter")).toBe(
      false,
    );
    expect(
      report.findings.some((candidate) => candidate.ruleId === "missing-path-ignore-for-non-code"),
    ).toBe(false);
  });

  test("flags elixir with outdated OTP (25) and Elixir (1.14) in setup-beam", async () => {
    const report = await getFixtureReport(fixtures.elixirSecurityAdvisoriesOk, {
      targetPath: ".",
      topCount: 50,
      mode: "exploratory",
    });

    const elixirFindings = report.findings.filter(
      (f) => f.ruleId === "elixir-otp-version-performance",
    );

    const otp25Findings = elixirFindings.filter((f) => f.message.includes("OTP 25"));
    const elixir14Findings = elixirFindings.filter((f) => f.message.includes("Elixir 1.14"));

    expect(otp25Findings.length).toBeGreaterThanOrEqual(1);
    expect(elixir14Findings.length).toBeGreaterThanOrEqual(1);
  });

  test("flags npm audit in a push/PR workflow", async () => {
    const report = await getFixtureReport(fixtures.npmAuditInCiLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const finding = report.findings.find((f) => f.ruleId === "npm-audit-in-ci");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("npm audit");
  });

  test("skips npm audit in a security-named scheduled workflow", async () => {
    const report = await getFixtureReport(fixtures.npmAuditInCiOk, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((f) => f.ruleId);
    expect(ruleIds).not.toContain("npm-audit-in-ci");
  });
});
