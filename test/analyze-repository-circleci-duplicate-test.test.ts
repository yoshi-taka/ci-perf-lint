import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { analyzeRepositoryForRule } from "./helpers.ts";

const rule = { id: "circleci-duplicate-test-across-jobs", severity: "warning" } as const;

async function findings(fixture: string) {
  const report = await analyzeRepositoryForRule(
    { cwd: fixture, targetPath: ".", topCount: 100 },
    rule,
  );
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("CircleCI duplicate test across jobs", () => {
  test("reports the same Gradle suite in three jobs", async () => {
    const result = await findings(fixtures.circleciDuplicateTestGradleLike);
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe("high");
    expect(result[0]?.message).toContain("verify-coverage");
    expect(result[0]?.message).toContain("report-coverage");
    expect(result[0]?.message).toContain("3 times per pipeline");
    expect(result[0]?.message).toContain("clean, so no cache can help");
    expect(result[0]?.suggestion).toContain("persist_to_workspace");
    expect(result[0]?.location.path).toBe(".circleci/config.yml");
    expect(result[0]?.location.line).toBeGreaterThan(1);
  });

  test("medium confidence for gradle build versus gradle test", async () => {
    const result = await findings(fixtures.circleciDuplicateTestImpliedMedium);
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe("medium");
  });

  test("expression filters downgrade confidence to medium", async () => {
    const result = await findings(fixtures.circleciDuplicateTestExpressionMedium);
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe("medium");
  });

  test.each([
    ["disjoint branches", fixtures.circleciDuplicateTestBranchesOk],
    ["matrix", fixtures.circleciDuplicateTestMatrixOk],
    ["unit versus integration", fixtures.circleciDuplicateTestUnitIntegrationOk],
  ])("does not report %s", async (_name, fixture) => {
    expect(await findings(fixture)).toHaveLength(0);
  });
});
