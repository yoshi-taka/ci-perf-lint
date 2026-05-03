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

describe("unnecessary-checkout-when-only-using-artifacts rule", () => {
  test("flags checkout when job only uses artifact actions", async () => {
    const report = await getFixtureReport(fixtures.unnecessaryCheckoutArtifactLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when job has build commands", async () => {
    const report = await getFixtureReport(fixtures.unnecessaryCheckoutArtifactOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when run steps reference repo files (e.g. create_release)", async () => {
    const report = await getFixtureReport(fixtures.unnecessaryCheckoutArtifactReleaseOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when job uses git apply (needs working tree)", async () => {
    const report = await getFixtureReport(fixtures.unnecessaryCheckoutArtifactGitApplyOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when job uses peter-evans/create-pull-request (needs working tree)", async () => {
    const report = await getFixtureReport(fixtures.unnecessaryCheckoutArtifactCreatePrOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });
});
