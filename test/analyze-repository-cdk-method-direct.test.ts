import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";

const baseOptions = { targetPath: ".", topCount: 20, mode: "exploratory" as const };
const RULE_ID = "prefer-cdk-method-direct-in-development";

describe("analyzeRepository: prefer-cdk-method-direct-in-development", () => {
  test("flags development cdk deploy without --method=direct in workflows and package scripts", async () => {
    const report = await getFixtureReport(
      fixtures.preferCdkMethodDirectInDevelopmentLike,
      baseOptions,
    );

    const workflowFinding = report.findings.find(
      (finding) => finding.ruleId === RULE_ID && finding.location.path.endsWith("deploy.yml"),
    );
    expect(workflowFinding).toBeDefined();

    const scriptFinding = report.findings.find(
      (finding) => finding.ruleId === RULE_ID && finding.location.path === "package.json",
    );
    expect(scriptFinding).toBeDefined();
    expect(scriptFinding!.scope).toBe("repository");
  });

  test("does not flag when --method=direct is already used", async () => {
    const report = await getFixtureReport(
      fixtures.preferCdkMethodDirectInDevelopmentOk,
      baseOptions,
    );
    expect(report.findings.some((finding) => finding.ruleId === RULE_ID)).toBe(false);
  });
});
