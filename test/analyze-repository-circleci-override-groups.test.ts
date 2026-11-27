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

test("override-with hides the local job body", async () => {
  expect(
    await findings(fixtures.circleciOverrideWithOk, "circleci-parallelism-without-test-splitting"),
  ).toHaveLength(0);
  expect(await findings(fixtures.circleciOverrideWithOk, "missing-dependency-cache")).toHaveLength(
    0,
  );
});

test("a plain invocation of an overridden job is still analyzed", async () => {
  const result = await findings(
    fixtures.circleciOverrideWithMixedLike,
    "circleci-parallelism-without-test-splitting",
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.message).toContain('"plain"');
});

test("job groups expand into duplicate test findings and name the group", async () => {
  const result = await findings(
    fixtures.circleciJobGroupDuplicateLike,
    "circleci-duplicate-test-across-jobs",
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.message).toContain("checks-group");
});

test("different tasks inside a job group are not duplicates", async () => {
  expect(
    await findings(fixtures.circleciJobGroupScopeOk, "circleci-duplicate-test-across-jobs"),
  ).toHaveLength(0);
});
