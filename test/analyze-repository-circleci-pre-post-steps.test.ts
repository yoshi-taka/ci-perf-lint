import { expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { analyzeRepositoryForRule } from "./helpers.ts";

async function findings(fixture: string, ruleId: string) {
  const report = await analyzeRepositoryForRule(
    { cwd: fixture, targetPath: ".", topCount: 100, mode: "exploratory", workflowOnly: true },
    { id: ruleId, severity: "suggestion" },
  );
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test("pre/post cache steps suppress missing-dependency-cache", async () => {
  expect(await findings(fixtures.circleciPrePostCacheOk, "missing-dependency-cache")).toHaveLength(
    0,
  );
});

test("a restore in pre-steps is reported at the invocation location", async () => {
  const result = await findings(
    fixtures.circleciPreStepsNodeModulesLike,
    "circleci-node-modules-cache-with-npm-ci",
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.location.line).toBeGreaterThan(1);
});

test("only the uncached invocation is reported", async () => {
  const result = await findings(fixtures.circleciPreStepsMixedLike, "missing-dependency-cache");
  expect(result).toHaveLength(1);
  expect(result[0]?.message).toContain("npm");
});
