import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { memoizedAnalyzeRepository } from "./helpers.ts";

const ruleId = "circleci-parallelism-without-test-splitting";

async function findings(fixture: string, mode: "strict" | "exploratory" = "strict") {
  const report = await memoizedAnalyzeRepository({
    cwd: fixture,
    targetPath: ".",
    topCount: 100,
    mode,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe("CircleCI parallelism without test splitting", () => {
  test("docker build and push with parallelism is reported", async () => {
    const result = await findings(fixtures.circleciParallelismDockerLike);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("warning");
    expect(result[0]?.confidence).toBe("high");
    expect(result[0]?.message).toContain("parallelism: 3");
    expect(result[0]?.message).toContain("xlarge");
    expect(result[0]?.message).toContain("Each of the 3 nodes repeats the same work");
    expect(result[0]?.why).toContain("identical build or push");
    expect(result[0]?.location.path).toBe(".circleci/config.yml");
    expect(result[0]?.location.line).toBeGreaterThan(1);
  });

  test("lint-only parallelism is reported", async () => {
    const result = await findings(fixtures.circleciParallelismLintLike);
    expect(result).toHaveLength(1);
    expect(result[0]?.why).toContain("same lint checks run on every node");
  });

  test("Maven install with parallelism is reported", async () => {
    expect(await findings(fixtures.circleciParallelismMvnLike)).toHaveLength(1);
  });

  test.each([
    ["circleci tests run", fixtures.circleciParallelismSplitOk],
    ["node index", fixtures.circleciParallelismNodeIndexOk],
    ["traced scripts", fixtures.circleciParallelismScriptOk],
    ["parallelism 1", fixtures.circleciParallelismOneOk],
    ["unresolved parameter", fixtures.circleciParallelismParameterOk],
  ])("does not report %s", async (_name, fixture) => {
    expect(await findings(fixture, "exploratory")).toHaveLength(0);
  });

  test("unresolved orb step is low confidence and exploratory only", async () => {
    expect(await findings(fixtures.circleciParallelismOrbLow)).toHaveLength(0);
    const result = await findings(fixtures.circleciParallelismOrbLow, "exploratory");
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("suggestion");
    expect(result[0]?.confidence).toBe("low");
  });
});
