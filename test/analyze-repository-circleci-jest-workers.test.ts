import { describe, expect, test } from "bun:test";
import { analyzeRepositoryForRule } from "./helpers.ts";
import { fixtures } from "./fixtures.ts";

const rule = { id: "circleci-jest-without-max-workers", severity: "warning" } as const;

async function findings(fixture: string, workflowOnly = false) {
  const report = await analyzeRepositoryForRule(
    { cwd: fixture, targetPath: ".", topCount: 100, workflowOnly },
    rule,
  );
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("CircleCI Jest worker tuning", () => {
  test("direct Jest on a large Docker job is high confidence and suggests 4", async () => {
    const result = await findings(fixtures.circleciJestLike);
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe("high");
    expect(result[0]?.message).toContain("large, 4 vCPU");
    expect(result[0]?.suggestion).toContain("--maxWorkers=4");
  });

  test("npm test through package scripts is medium and suggests default medium 2", async () => {
    const result = await findings(fixtures.circleciJestScriptMediumLike);
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe("medium");
    expect(result[0]?.suggestion).toContain("--maxWorkers=2");
  });

  test("react-scripts test is reported", async () => {
    expect(await findings(fixtures.circleciJestReactScriptsLike)).toHaveLength(1);
  });

  test("percentage workers are medium and called out", async () => {
    const result = await findings(fixtures.circleciJestPercentMediumLike);
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe("medium");
    expect(result[0]?.message).toContain("host VM's CPUs");
  });

  test.each([
    ["--maxWorkers", fixtures.circleciJestAbsoluteOk],
    ["-w", fixtures.circleciJestWFlagOk],
    ["--runInBand", fixtures.circleciJestInbandOk],
    ["-i", fixtures.circleciJestIOk],
    ["package.json jest", fixtures.circleciJestPackageConfigOk],
    ["jest.config.js", fixtures.circleciJestConfigFileOk],
    ["macOS executor", fixtures.circleciJestMacosOk],
  ])("does not report %s", async (_name, fixture) => {
    expect(await findings(fixture)).toHaveLength(0);
  });

  test("pre-step tuning applies to one invocation only", async () => {
    const result = await findings(fixtures.circleciJestInvocationLike);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain('"untuned"');
  });

  test("workflow-only mode ignores indirect npm test", async () => {
    expect(await findings(fixtures.circleciJestWorkflowOnlyOk, true)).toHaveLength(0);
  });
});
