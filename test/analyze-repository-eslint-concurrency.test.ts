import { afterEach, describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("prefer-eslint-concurrency", () => {
  test("flags eslint versions below the multithread release", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.eslintConcurrencyOldLike,
      targetPath: ".",
      topCount: 20,
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-eslint-concurrency",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.docsPath).toBe("docs/rules/prefer-eslint-concurrency.md");
    expect(finding?.message).toContain("below the release that added multithread linting");
    expect(finding?.suggestion).toContain("--concurrency=auto");
  });

  test("flags package scripts that run eslint without concurrency", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.eslintConcurrencyScriptLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-eslint-concurrency",
    );

    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain('"lint"');
    expect(finding?.message).toContain("without multithread linting");
  });

  test("flags github actions steps that run eslint without concurrency", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.eslintConcurrencyWorkflowLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-eslint-concurrency",
    );

    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain("Workflow runs ESLint without multithread linting");
  });

  test("ignores eslint 8 where flat config migration is a prerequisite", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.eslintConcurrencyEslint8,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "prefer-eslint-concurrency"),
    ).toBe(false);
  });

  test("stays silent when concurrency is already enabled", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.eslintConcurrencyOk,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "prefer-eslint-concurrency"),
    ).toBe(false);
  });
});
