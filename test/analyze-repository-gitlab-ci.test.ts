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

describe("analyzeRepository GitLab CI rules", () => {
  test("finds missing timeout in GitLab CI jobs", async () => {
    const report = await getFixtureReport(fixtures.gitlabCiTimeoutLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(report.workflowCount).toBe(1);
    expect(ruleIds).toContain("missing-timeout-in-minutes-gitlab-ci");

    const timeoutFinding = report.findings.find(
      (finding) => finding.ruleId === "missing-timeout-in-minutes-gitlab-ci",
    );
    expect(timeoutFinding).toBeDefined();
    expect(timeoutFinding?.message).toContain("timeout");
  });

  test("does not flag timeouts when all heavy jobs have timeout", async () => {
    const report = await getFixtureReport(fixtures.gitlabCiTimeoutOk, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(report.workflowCount).toBe(1);
    expect(ruleIds).not.toContain("missing-timeout-in-minutes-gitlab-ci");
  });
});
