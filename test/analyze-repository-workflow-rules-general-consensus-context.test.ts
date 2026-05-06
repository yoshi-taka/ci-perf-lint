import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { getWorkflowFocusedFixtureReport } from "./helpers.ts";

describe("analyzeRepository workflow and execution rules: consensus and precedent context", () => {
  test("adds similar-job consensus context to missing-dependency-cache", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.consensusCacheLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const cacheFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-dependency-cache" &&
        candidate.workflow === ".github/workflows/ci-d.yml",
    );

    expect(cacheFinding).toBeDefined();
    expect(cacheFinding?.why).toContain("similar jobs already use dependency caching");
    expect(cacheFinding?.why).toContain(".github/workflows/ci-a.yml:test");
  });

  test("adds similar-job consensus context to deep-checkout-without-need", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.consensusDeepCheckoutLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const checkoutFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "deep-checkout-without-need" &&
        candidate.workflow === ".github/workflows/build-d.yml",
    );

    expect(checkoutFinding).toBeDefined();
    expect(checkoutFinding?.why).toContain("similar jobs already avoid full-history checkout");
    expect(checkoutFinding?.why).toContain(".github/workflows/build-a.yml:build");
  });

  test("adds repository precedent context to missing-dependency-cache without consensus", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.precedentCacheLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-dependency-cache" &&
        candidate.workflow === ".github/workflows/uncached.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already uses dependency caching");
    expect(finding?.why).toContain(".github/workflows/cached.yml:test");
    expect(finding?.why).not.toContain("similar jobs already use dependency caching");
  });

  test("adds repository precedent context to deep-checkout-without-need without consensus", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.precedentDeepCheckoutLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "deep-checkout-without-need" &&
        candidate.workflow === ".github/workflows/deep.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already keeps checkout shallow");
    expect(finding?.why).toContain(".github/workflows/shallow.yml:build");
    expect(finding?.why).not.toContain("similar jobs already avoid full-history checkout");
  });

  test("adds repository precedent context to missing-paths-filter without consensus", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.precedentPathsFilterLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-paths-filter" &&
        candidate.workflow === ".github/workflows/unscoped.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already uses trigger path filters");
    expect(finding?.why).toContain(".github/workflows/scoped.yml");
  });

  test("adds similar-workflow consensus context to missing-paths-filter", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.consensusPathsFilterLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-paths-filter" &&
        candidate.workflow === ".github/workflows/build-d.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("similar workflows already narrow triggers");
    expect(finding?.why).toContain(".github/workflows/build-a.yml");
  });

  test("adds repository precedent context to outdated-setup-action-without-cache", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.precedentSetupCacheLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "outdated-setup-action-without-cache" &&
        candidate.workflow === ".github/workflows/legacy.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already uses setup-action cache configuration");
    expect(finding?.why).toContain(".github/workflows/modern.yml:test");
  });

  test("adds repository precedent context to missing-path-ignore-for-non-code without consensus", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.precedentNonCodeIgnoreLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-path-ignore-for-non-code" &&
        candidate.workflow === ".github/workflows/unignored.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already ignores obvious non-code changes");
    expect(finding?.why).toContain(".github/workflows/ignored.yml");
  });

  test("adds similar-workflow consensus context to missing-path-ignore-for-non-code", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.consensusNonCodeIgnoreLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-path-ignore-for-non-code" &&
        candidate.workflow === ".github/workflows/ignore-d.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("similar workflows already ignore obvious non-code changes");
    expect(finding?.why).toContain(".github/workflows/ignore-a.yml");
  });

  test("adds repository precedent context to redundant-manual-cache-with-setup-action", async () => {
    const report = await getWorkflowFocusedFixtureReport(
      fixtures.precedentSingleCacheStrategyLike,
      {
        targetPath: ".",
        topCount: 20,
        mode: "exploratory",
      },
    );

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "redundant-manual-cache-with-setup-action" &&
        candidate.workflow === ".github/workflows/overlap-cache.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain(
      "This repository already relies on setup-action cache without overlapping manual cache",
    );
    expect(finding?.why).toContain(".github/workflows/simple-cache.yml:test");
  });
});
