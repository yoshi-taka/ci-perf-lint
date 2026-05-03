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

describe("analyzeRepository Depot CI", () => {
  test("detects and analyzes .depot/workflows/ workflows", async () => {
    const report = await getFixtureReport(fixtures.depotCiLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.workflowCount).toBe(1);
    expect(report.workflows[0]?.path).toContain(".depot/workflows/");
  });

  test("applies existing GitHub Actions rules to Depot CI workflows", async () => {
    const report = await getFixtureReport(fixtures.depotCiLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.workflowCount).toBe(1);
    expect(report.findings.length).toBeGreaterThan(0);
  });
});
