import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";

const baseOptions = { targetPath: ".", topCount: 20, mode: "exploratory" as const };
const RULE_ID = "prefer-aws-cdk-cli-2-1125-for-hotswap";

describe("analyzeRepository: prefer-aws-cdk-cli-2-1125-for-hotswap", () => {
  test("flags hotswap usage on an older aws-cdk CLI in workflows and package scripts", async () => {
    const report = await getFixtureReport(fixtures.preferAwsCdkCli21125HotswapLike, baseOptions);

    const workflowFinding = report.findings.find(
      (finding) => finding.ruleId === RULE_ID && finding.location.path.endsWith("dev.yml"),
    );
    expect(workflowFinding).toBeDefined();
    expect(workflowFinding!.severity).toBe("warning");

    const scriptFinding = report.findings.find(
      (finding) => finding.ruleId === RULE_ID && finding.location.path === "package.json",
    );
    expect(scriptFinding).toBeDefined();
    expect(scriptFinding!.scope).toBe("repository");
  });

  test("does not flag hotswap usage on a supported aws-cdk CLI version", async () => {
    const report = await getFixtureReport(fixtures.preferAwsCdkCli21125HotswapOk, baseOptions);
    expect(report.findings.some((finding) => finding.ruleId === RULE_ID)).toBe(false);
  });
});
