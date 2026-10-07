import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

const baseOptions = { targetPath: ".", topCount: 20, mode: "exploratory" as const };

async function writeLockfileRepo(resolvedVersion: string): Promise<string> {
  const fixtureRoot = await tempDirs.create("apl-cdk-lockfile-");
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    '{"name":"lockfile-repo","devDependencies":{"aws-cdk-lib":"^2.0.0","typescript":"5.6.0"}}',
  );
  await writeFile(path.join(fixtureRoot, "cdk.json"), "{}");
  await writeFile(
    path.join(fixtureRoot, "package-lock.json"),
    JSON.stringify({
      name: "lockfile-repo",
      lockfileVersion: 3,
      packages: {
        "": { name: "lockfile-repo", devDependencies: { "aws-cdk-lib": "^2.0.0" } },
        "node_modules/aws-cdk-lib": { version: resolvedVersion },
      },
    }),
  );
  return fixtureRoot;
}

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

  test("uses the lockfile-resolved version over a caret range", async () => {
    const fixtureRoot = await writeLockfileRepo("2.263.0");
    const report = await getFixtureReport(fixtureRoot, baseOptions);
    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).toContain("prefer-aws-cdk-lib-2-267");
    expect(ruleIds).not.toContain("prefer-aws-cdk-lib-offline-validation");
  });

  test("does not flag the affected range when the lockfile resolves to a fixed version", async () => {
    const fixtureRoot = await writeLockfileRepo("2.267.0");
    const report = await getFixtureReport(fixtureRoot, baseOptions);
    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("prefer-aws-cdk-lib-2-267");
    expect(ruleIds).not.toContain("prefer-aws-cdk-lib-offline-validation");
  });
});
