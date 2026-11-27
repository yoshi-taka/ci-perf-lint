import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { analyzeRepositoryForRule } from "./helpers.ts";

const rule = {
  id: "circleci-unnecessary-setup-remote-docker",
  severity: "suggestion",
} as const;

async function findings(fixture: string, workflowOnly = false) {
  const report = await analyzeRepositoryForRule(
    { cwd: fixture, targetPath: ".", topCount: 100, mode: "exploratory", workflowOnly },
    rule,
  );
  return report.findings.filter((candidate) => candidate.ruleId === rule.id);
}

describe("CircleCI setup_remote_docker with indirect commands", () => {
  test("make target running docker build suppresses the finding", async () => {
    expect(await findings(fixtures.circleciRemoteDockerMakeOk)).toHaveLength(0);
  });

  test("untraceable Makefile suppresses the finding", async () => {
    expect(await findings(fixtures.circleciRemoteDockerMakeMissingOk, true)).toHaveLength(0);
  });

  test("make target without docker is still reported", async () => {
    expect(await findings(fixtures.circleciRemoteDockerMakeNoDockerLike)).toHaveLength(1);
  });

  test("inline npm test is still reported", async () => {
    expect(await findings(fixtures.circleciRemoteDockerInlineLike)).toHaveLength(1);
  });
});
