import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import { collectCdkAssetBuildConcurrencyDiagnostics } from "../src/repository-diagnostics/cdk-asset-build-concurrency.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import path from "node:path";
import { parseWorkflow } from "../src/workflow.ts";
import type { RuleModule } from "../src/rule-engine/types.ts";
import { preferAwsCdkCli21125ForHotswapRule } from "../src/rules/prefer-aws-cdk-cli-2-1125-for-hotswap.ts";
import { preferCdkExpressModeInDevelopmentRule } from "../src/rules/prefer-cdk-express-mode-in-development.ts";
import { preferCdkMethodDirectInDevelopmentRule } from "../src/rules/prefer-cdk-method-direct-in-development.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(files: Record<string, string>, directRules: RuleModule[] = []) {
  const cwd = await tempDirs.create("apl-cdk-version-regression-");
  await writeRepositoryFiles(cwd, files);
  if (directRules.length > 0) {
    // Inspect per-command advice before the engine's co-located-finding deduplication.
    const workflowPath = ".github/workflows/ci.yml";
    const workflow = parseWorkflow(path.join(cwd, workflowPath), cwd, files[workflowPath]!);
    const scanContext = new RepositoryScanContext(cwd, []);
    const { signals: repository } = await collectRepositorySignals(
      cwd,
      [workflow],
      [],
      scanContext,
    );
    const findings = await Promise.all(
      directRules.map(async (rule) => rule.check(workflow, { repository, scanContext })),
    );
    return { findings: findings.flat() };
  }
  return analyzeRepository({ cwd, targetPath: ".", topCount: 50, mode: "exploratory" });
}

describe("CDK version-scoped findings", () => {
  test.each(["\n", " && ", "; "])(
    "resolves CLI versions in shell order across %j",
    async (separator) => {
      const commands = [
        "cdk deploy --hotswap",
        "npm install -g aws-cdk@2.1138.0",
        "cdk deploy --hotswap",
        "npm install -g aws-cdk@2.1100.0",
        "cdk deploy --hotswap",
      ];
      const report = await scan(
        {
          "package.json": JSON.stringify({ devDependencies: { "aws-cdk": "2.1100.0" } }),
          ".github/workflows/ci.yml": `on: pull_request
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: |
          ${commands.join(separator).replaceAll("\n", "\n          ")}
`,
        },
        [preferAwsCdkCli21125ForHotswapRule, preferCdkExpressModeInDevelopmentRule],
      );
      const hotswap = report.findings.filter(
        (finding) =>
          finding.ruleId === "prefer-aws-cdk-cli-2-1125-for-hotswap" &&
          finding.scope !== "repository",
      );
      expect(hotswap).toHaveLength(1);
      expect(hotswap[0]?.message).toContain("2.1100.0");
      const express = report.findings.filter(
        (finding) =>
          finding.ruleId === "prefer-cdk-express-mode-in-development" &&
          finding.scope !== "repository",
      );
      expect(express).toHaveLength(2);
      expect(express.find((finding) => finding.message.includes("2.1100.0"))?.suggestion).toContain(
        "Upgrade",
      );
      expect(
        express.find((finding) => finding.message.includes("2.1138.0"))?.suggestion,
      ).not.toContain("Upgrade");
    },
  );

  test("a later install does not enable method=direct on an earlier deploy", async () => {
    const report = await scan(
      {
        "package.json": JSON.stringify({ devDependencies: { "aws-cdk": "2.100.0" } }),
        ".github/workflows/ci.yml": `on: pull_request
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: |
          cdk deploy
          npm install -g aws-cdk@2.1138.0
`,
      },
      [preferCdkMethodDirectInDevelopmentRule],
    );
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "prefer-cdk-method-direct-in-development",
      ),
    ).toBe(false);
  });

  test("repository analysis retains hotswap advice before a later same-step install", async () => {
    const report = await scan({
      "package.json": JSON.stringify({ devDependencies: { "aws-cdk": "2.1100.0" } }),
      ".github/workflows/ci.yml": `on: pull_request
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: |
          cdk deploy --hotswap
          npm install -g aws-cdk@2.1138.0
`,
    });
    const finding = report.findings.find(
      (item) => item.ruleId === "prefer-aws-cdk-cli-2-1125-for-hotswap",
    );
    expect(finding?.message).toContain("2.1100.0");
    expect(finding?.message).not.toContain("npm install");
  });

  test("flags belong to individual CDK commands in a step", async () => {
    const report = await scan(
      {
        "package.json": JSON.stringify({ devDependencies: { "aws-cdk": "2.1138.0" } }),
        ".github/workflows/ci.yml": `on: pull_request
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: |
          cdk deploy --express --method=direct
          cdk deploy
`,
      },
      [preferCdkExpressModeInDevelopmentRule, preferCdkMethodDirectInDevelopmentRule],
    );
    for (const ruleId of [
      "prefer-cdk-express-mode-in-development",
      "prefer-cdk-method-direct-in-development",
    ]) {
      expect(
        report.findings.some(
          (finding) => finding.ruleId === ruleId && finding.scope !== "repository",
        ),
      ).toBe(true);
    }
  });

  test("package script advice uses the lockfile-resolved CLI version", async () => {
    const report = await scan({
      "package.json": JSON.stringify({
        devDependencies: { "aws-cdk": "^2.1000.0", typescript: "7.0.2" },
        scripts: { "deploy:dev": "cdk deploy" },
      }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { devDependencies: { "aws-cdk": "^2.1000.0" } },
          "node_modules/aws-cdk": { version: "2.1100.0" },
        },
      }),
      ".github/workflows/ci.yml":
        "on: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm install\n",
    });
    const finding = report.findings.find(
      (f) => f.ruleId === "prefer-cdk-express-mode-in-development",
    );
    expect(finding).toBeDefined();
    expect(finding?.suggestion).toContain("Upgrade");
    expect(finding?.message).toContain("2.1100.0");
  });

  test("a newer nested library does not hide a vulnerable direct library", async () => {
    const report = await scan({
      "package.json": JSON.stringify({
        devDependencies: { "aws-cdk-lib": "^2.0.0", typescript: "7.0.2" },
      }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { devDependencies: { "aws-cdk-lib": "^2.0.0" } },
          "node_modules/aws-cdk-lib": { version: "2.263.0" },
          "node_modules/other/node_modules/aws-cdk-lib": { version: "2.267.0" },
        },
      }),
    });
    expect(report.findings.some((f) => f.ruleId === "prefer-aws-cdk-lib-2-267")).toBe(true);
  });

  test("workflow CLI versions belong to the target job and precede its deploy", async () => {
    const report = await scan({
      "package.json": JSON.stringify({
        devDependencies: { "aws-cdk": "2.1100.0", typescript: "7.0.2" },
      }),
      ".github/workflows/ci.yml": `on:
  pull_request:
jobs:
  recent:
    runs-on: ubuntu-latest
    steps:
      - run: npm install -g aws-cdk@2.1138.0
      - run: cdk deploy --hotswap
      - run: cdk deploy
  old:
    runs-on: ubuntu-latest
    steps:
      - run: npm install -g aws-cdk@2.1100.0
      - run: cdk deploy --hotswap
      - run: cdk deploy
  future:
    runs-on: ubuntu-latest
    steps:
      - run: cdk deploy --hotswap
      - run: npm install -g aws-cdk@2.1138.0
  changes:
    runs-on: ubuntu-latest
    steps:
      - run: npm install -g aws-cdk@2.1138.0
      - run: cdk deploy --hotswap
      - run: npm install -g aws-cdk@2.1100.0
      - run: cdk deploy --hotswap
  expressOld:
    runs-on: ubuntu-latest
    steps:
      - run: npm install -g aws-cdk@2.1100.0
      - run: cdk deploy
  expressNew:
    runs-on: ubuntu-latest
    steps:
      - run: npm install -g aws-cdk@2.1138.0
      - run: cdk deploy
`,
    });
    const hotswap = report.findings.filter(
      (f) => f.ruleId === "prefer-aws-cdk-cli-2-1125-for-hotswap" && f.scope !== "repository",
    );
    expect(hotswap).toHaveLength(3);
    expect(hotswap.every((f) => f.message.includes("2.1100.0"))).toBe(true);
    expect(hotswap.some((f) => f.message.includes('"recent"'))).toBe(false);
    const express = report.findings.filter(
      (f) => f.ruleId === "prefer-cdk-express-mode-in-development" && f.scope !== "repository",
    );
    expect(express.find((f) => f.message.includes('"expressOld"'))?.suggestion).toContain(
      "Upgrade",
    );
    expect(express.find((f) => f.message.includes('"expressNew"'))?.suggestion).not.toContain(
      "Upgrade",
    );
  });

  test("asset concurrency does not scan source when no deploy needs it", async () => {
    const cwd = await tempDirs.create("apl-non-cdk-scan-");
    await writeRepositoryFiles(cwd, {
      "package.json": '{"devDependencies":{"typescript":"7.0.2"}}',
      "src/index.ts": "export const value = 1;",
    });
    const context = new RepositoryScanContext(cwd, []);
    const { signals } = await collectRepositorySignals(cwd, [], [], context);
    const walk = spyOn(context, "walkFiles");
    try {
      expect(
        await collectCdkAssetBuildConcurrencyDiagnostics(cwd, signals, [], [], context),
      ).toEqual([]);
      expect(walk).not.toHaveBeenCalled();
    } finally {
      walk.mockRestore();
    }
  });
});
