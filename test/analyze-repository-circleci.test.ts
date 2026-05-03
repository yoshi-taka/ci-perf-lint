import { afterEach, describe, expect, test } from "bun:test";
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

describe("analyzeRepository CircleCI rules", () => {
  test("parses .circleci/config.yml and discovers jobs", async () => {
    const report = await getFixtureReport(fixtures.circleciFullCloneLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.workflowCount).toBe(1);
    expect(report.workflows[0]?.path).toContain(".circleci/config.yml");
  });

  test("finds checkout method: full without git history need", async () => {
    const report = await getFixtureReport(fixtures.circleciFullCloneLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.length).toBeGreaterThan(0);
    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("circleci-checkout-uses-full-clone");
  });

  test("does not flag blobless checkout", async () => {
    const report = await getFixtureReport(fixtures.circleciFullCloneOk, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(ruleIds).not.toContain("circleci-checkout-uses-full-clone");
  });

  test("does not flag full checkout when git history is needed", async () => {
    const report = await getFixtureReport(fixtures.circleciFullCloneOkUsesHistory, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(ruleIds).not.toContain("circleci-checkout-uses-full-clone");
  });
});
