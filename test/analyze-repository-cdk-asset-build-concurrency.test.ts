import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtures } from "./fixtures.ts";
import { getFixtureReport } from "./repository-diagnostics-test-helpers.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

const baseOptions = { targetPath: ".", topCount: 20, mode: "exploratory" as const };
const RULE_ID = "prefer-cdk-asset-build-concurrency";

describe("analyzeRepository: prefer-cdk-asset-build-concurrency", () => {
  test("suggests asset build concurrency for multiple Docker assets without the flag", async () => {
    const report = await getFixtureReport(fixtures.preferCdkAssetBuildConcurrencyLike, baseOptions);

    const finding = report.findings.find((candidate) => candidate.ruleId === RULE_ID);
    expect(finding).toBeDefined();
    expect(finding!.scope).toBe("repository");
    expect(finding!.severity).toBe("suggestion");
    expect(finding!.location.path.endsWith("deploy.yml")).toBe(true);
  });

  test("does not flag when --asset-build-concurrency is present", async () => {
    const report = await getFixtureReport(fixtures.preferCdkAssetBuildConcurrencyOk, baseOptions);
    expect(report.findings.some((candidate) => candidate.ruleId === RULE_ID)).toBe(false);
  });

  test("does not flag a single Docker asset", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-asset-single-");
    await mkdir(path.join(fixtureRoot, "lib"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      '{"name": "single", "devDependencies": {"aws-cdk-lib": "2.267.0", "typescript": "5.6.0"}}',
    );
    await writeFile(
      path.join(fixtureRoot, "lib", "stack.ts"),
      'const a = DockerImageCode.fromImageAsset("./a");\n',
    );

    const report = await getFixtureReport(fixtureRoot, baseOptions);
    expect(report.findings.some((candidate) => candidate.ruleId === RULE_ID)).toBe(false);
  });
});
