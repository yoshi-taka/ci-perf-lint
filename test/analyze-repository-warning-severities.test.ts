import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { getWorkflowFocusedFixtureReport } from "./helpers.ts";

describe("performance warnings in default strict mode", () => {
  test.each([
    ["missing-concurrency", fixtures.sampleRepo],
    ["missing-paths-filter", fixtures.sampleRepo],
    ["missing-path-ignore-for-non-code", fixtures.sampleRepo],
    ["ungated-heavy-job", fixtures.ungatedHeavyJobLike],
    ["duplicate-install-or-lint", fixtures.duplicationLike],
    ["repeated-build-in-same-workflow", fixtures.workflowEfficiencyLike],
    ["matrix-test-job-without-test-sharding", fixtures.matrixShardLike],
    ["redundant-manual-cache-with-setup-action", fixtures.workflowEfficiencyLike],
  ])("%s is not hidden behind exploratory mode", async (ruleId, cwd) => {
    const report = await getWorkflowFocusedFixtureReport(cwd, {
      targetPath: ".",
      topCount: 100,
    });
    const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
  });
});
