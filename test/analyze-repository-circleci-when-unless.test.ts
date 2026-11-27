import { expect, test } from "bun:test";
import { analyzeRepositoryForRule } from "./helpers.ts";
import { fixtures } from "./fixtures.ts";

async function findings(
  fixture: string,
  ruleId: string,
  severity: "warning" | "suggestion" = "suggestion",
) {
  const report = await analyzeRepositoryForRule(
    { cwd: fixture, targetPath: ".", topCount: 100, mode: "exploratory", workflowOnly: true },
    { id: ruleId, severity },
  );
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test("cache steps inside a true when block suppress missing-dependency-cache", async () => {
  expect(await findings(fixtures.circleciWhenCacheOk, "missing-dependency-cache")).toHaveLength(0);
});

test("cache steps inside an unless with an empty default string stay active", async () => {
  expect(
    await findings(fixtures.circleciUnlessEmptyCacheOk, "missing-dependency-cache"),
  ).toHaveLength(0);
});

test("a conditional restore lowers node_modules cache finding confidence", async () => {
  const result = await findings(
    fixtures.circleciWhenNodeModulesLike,
    "circleci-node-modules-cache-with-npm-ci",
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.confidence).toBe("low");
});

test("docker build inside a statically false when block is ignored", async () => {
  expect(
    await findings(fixtures.circleciWhenFalseDockerOk, "docker-build-without-layer-cache"),
  ).toHaveLength(0);
});
