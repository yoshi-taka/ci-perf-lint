import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, getWorkflowFocusedFixtureReport } from "./helpers.ts";
import type { memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return getWorkflowFocusedFixtureReport(cwd, options);
}

describe("analyzeRepository workflow and execution rules: general context", () => {
  test("does not flag deep checkout when tag publishing visibly needs history or tags", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutReleaseLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when versioning work visibly needs history", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutVersionLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when a repo-local script hides its history needs", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutOpaqueScript, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when a bare dev script may hide history usage", async () => {
    const fixtureRoot = await tempDirs.create("apl-deep-checkout-dev-script-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "dev"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "package.json"), '{"name":"dev-script-fixture"}');
    await writeFile(path.join(fixtureRoot, "dev", "update-authors.js"), "console.log('x')\n");
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "authors.yml"),
      [
        "name: authors",
        "on: workflow_dispatch",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "      - run: dev/update-authors.js",
      ].join("\n"),
    );

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when a write-capable issue-management action may mutate the repository", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutMutatingAction, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when the job explicitly pulls, rebases, commits, and pushes", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutRebasePush, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("treats commitlint full-history checkout as intentional but still suggests blob:none", async () => {
    const report = await getFixtureReport(fixtures.metaCheckLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const deepCheckoutFinding = report.findings.find(
      (finding) => finding.ruleId === "deep-checkout-without-need",
    );
    const blobNoneFinding = report.findings.find(
      (finding) => finding.ruleId === "consider-filter-blob-none-for-release-metadata",
    );

    expect(deepCheckoutFinding).toBeUndefined();
    expect(blobNoneFinding?.message).toContain('Job "commitlint"');
    expect(blobNoneFinding?.why).toContain("commit");
    expect(blobNoneFinding?.suggestion).toContain("filter: blob:none");
  });

  test("flags deep checkout when fetch-depth >= 1000 without history need", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutExcessiveLike, {
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    const finding = report.findings.find((f) => f.ruleId === "deep-checkout-excessive-depth");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("fetch-depth: 1000");
    expect(finding?.suggestion).toContain("Reduce fetch-depth");
    expect(finding?.severity).toBe("warning");
  });

  test("does not flag deep checkout with fetch-depth >= 1000 when history-dependent command is present", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutExcessiveOkUsesHistory, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((f) => f.ruleId === "deep-checkout-excessive-depth")).toBe(false);
  });

  test("does not flag deep checkout with fetch-depth >= 1000 in a release-like workflow", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutExcessiveOkRelease, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((f) => f.ruleId === "deep-checkout-excessive-depth")).toBe(false);
  });

  test("defaults to warning-only output", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 10,
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));

    expect(ruleIds.has("missing-concurrency")).toBe(false);
    expect(ruleIds.has("missing-paths-filter")).toBe(false);
    expect(ruleIds.has("missing-path-ignore-for-non-code")).toBe(false);
    expect(ruleIds.has("missing-dependency-cache")).toBe(false);
    expect(ruleIds.has("ungated-heavy-job")).toBe(false);
  });

  test("keeps a clean fixture at zero findings in both strict and exploratory mode", async () => {
    const strictReport = await getFixtureReport(fixtures.cleanNoFindings, {
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });
    const exploratoryReport = await getFixtureReport(fixtures.cleanNoFindings, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(strictReport.findings).toHaveLength(0);
    expect(exploratoryReport.findings).toHaveLength(0);
    expect(strictReport.workflowCount).toBe(1);
    expect(exploratoryReport.workflowCount).toBe(1);
  });

  test("warns when npm install is used instead of npm ci", async () => {
    const report = await getFixtureReport(fixtures.npmCiOverNpmInstallLike, {
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    const finding = report.findings.find((f) => f.ruleId === "prefer-npm-ci");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("npm install");
    expect(finding?.suggestion).toContain("npm ci");
  });

  test("does not warn when npm ci is used instead of npm install", async () => {
    const report = await getFixtureReport(fixtures.npmCiOk, {
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    expect(report.findings.some((f) => f.ruleId === "prefer-npm-ci")).toBe(false);
  });

  test("warns when pnpm/yarn/bun install without frozen lockfile flag", async () => {
    const report = await getFixtureReport(fixtures.frozenLockfileLike, {
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    const finding = report.findings.find((f) => f.ruleId === "prefer-frozen-lockfile");
    expect(finding).toBeDefined();
    expect(finding?.message).toMatch(/pnpm|yarn|bun/);
  });

  test("supports exploratory mode for advisory findings", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));

    expect(ruleIds.has("missing-concurrency")).toBe(true);
    expect(ruleIds.has("missing-paths-filter")).toBe(true);
    expect(ruleIds.has("missing-path-ignore-for-non-code")).toBe(true);
  });
});
