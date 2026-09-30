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

const baseOptions = { targetPath: ".", topCount: 20, mode: "strict" as const };
const RULE_ID = "prefer-cdk-express-mode-in-development";

describe("analyzeRepository: prefer-cdk-express-mode-in-development", () => {
  test("warns for a development workflow and a development package script without --express", async () => {
    const report = await getFixtureReport(
      fixtures.preferCdkExpressModeInDevelopmentLike,
      baseOptions,
    );

    const workflowFinding = report.findings.find(
      (finding) => finding.ruleId === RULE_ID && finding.location.path.endsWith("deploy.yml"),
    );
    expect(workflowFinding).toBeDefined();
    expect(workflowFinding!.severity).toBe("warning");

    const scriptFinding = report.findings.find(
      (finding) => finding.ruleId === RULE_ID && finding.location.path === "package.json",
    );
    expect(scriptFinding).toBeDefined();
    expect(scriptFinding!.scope).toBe("repository");
  });

  test("does not warn when --express is already used", async () => {
    const report = await getFixtureReport(
      fixtures.preferCdkExpressModeInDevelopmentOk,
      baseOptions,
    );
    expect(report.findings.some((finding) => finding.ruleId === RULE_ID)).toBe(false);
  });

  test("does not warn for production or release deploys", async () => {
    const report = await getFixtureReport(
      fixtures.preferCdkExpressModeInDevelopmentProd,
      baseOptions,
    );
    expect(report.findings.some((finding) => finding.ruleId === RULE_ID)).toBe(false);
  });

  test("does not warn for manually dispatched workflows", async () => {
    const fixtureRoot = await tempDirs.create("apl-cdk-express-dispatch-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "deploy.yml"),
      [
        "name: deploy",
        "on:",
        "  workflow_dispatch:",
        "jobs:",
        "  deploy:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npx cdk deploy --all",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, baseOptions);
    expect(report.findings.some((finding) => finding.ruleId === RULE_ID)).toBe(false);
  });
});
