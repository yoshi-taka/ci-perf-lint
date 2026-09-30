import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";

const baseOptions = { targetPath: ".", topCount: 20, mode: "exploratory" as const };

describe("analyzeRepository: CDK version policy", () => {
  test("warns about enabled version reporting and flags the affected aws-cdk-lib range", async () => {
    const report = await getFixtureReport(fixtures.cdkVersionPolicyLike, baseOptions);

    const reportingFinding = report.findings.find(
      (finding) => finding.ruleId === "prefer-cdk-version-reporting-disabled",
    );
    expect(reportingFinding).toBeDefined();
    expect(reportingFinding!.scope).toBe("repository");
    expect(reportingFinding!.location.path).toBe("cdk.json");

    const versionFinding = report.findings.find(
      (finding) => finding.ruleId === "prefer-aws-cdk-lib-2-267",
    );
    expect(versionFinding).toBeDefined();
    expect(versionFinding!.scope).toBe("repository");
    expect(versionFinding!.location.path).toBe("package.json");

    expect(
      report.findings.some((finding) => finding.ruleId === "prefer-aws-cdk-lib-offline-validation"),
    ).toBe(false);
  });

  test("does not flag reporting disabled and a fixed aws-cdk-lib version", async () => {
    const report = await getFixtureReport(fixtures.cdkVersionPolicyOk, baseOptions);
    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("prefer-cdk-version-reporting-disabled");
    expect(ruleIds).not.toContain("prefer-aws-cdk-lib-2-267");
    expect(ruleIds).not.toContain("prefer-aws-cdk-lib-offline-validation");
  });

  test("recommends offline validation for versions below the validator release", async () => {
    const report = await getFixtureReport(fixtures.cdkVersionPolicyOld, baseOptions);
    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).toContain("prefer-aws-cdk-lib-offline-validation");
    expect(ruleIds).not.toContain("prefer-cdk-version-reporting-disabled");
    expect(ruleIds).not.toContain("prefer-aws-cdk-lib-2-267");
  });
});
