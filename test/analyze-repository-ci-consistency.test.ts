import { afterEach, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { parseWorkflow } from "../src/workflow.ts";
import { getTriggerFacts } from "../src/rules/shared/trigger-facts.ts";
import { ciKindForPath } from "../src/ci-types.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const job = "jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n";
const scan = (cwd: string) =>
  analyzeRepository({
    cwd,
    targetPath: ".",
    topCount: 50,
    mode: "exploratory",
    workflowOnly: true,
  });

describe("CI representation consistency", () => {
  test.each([
    ["on: push", "on:\n  push:"],
    ["on: pull_request", "on:\n  pull_request:"],
    ["on: [push, pull_request]", "on:\n  push:\n  pull_request:"],
    ["on: workflow_dispatch", "on:\n  workflow_dispatch:"],
  ])("normalizes %s without changing trigger facts", (short, expanded) => {
    const left = parseWorkflow("/repo/ci.yml", "/repo", `${short}\n${job}`);
    const right = parseWorkflow("/repo/ci.yml", "/repo", `${expanded}\n${job}`);
    expect(getTriggerFacts(left)).toEqual(getTriggerFacts(right));
  });

  test("adding other CI kinds does not hide GitHub prechecked findings", async () => {
    const cwd = await tempDirs.create("apl-mixed-ci-");
    await writeRepositoryFiles(cwd, {
      "package.json": '{"devDependencies":{"aws-cdk":"2.1138.0"}}',
      ".github/workflows/dev.yml":
        "on: pull_request\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment: development\n    steps:\n      - run: cdk deploy\n",
    });
    const ruleId = "prefer-cdk-express-mode-in-development";
    expect((await scan(cwd)).findings.some((f) => f.ruleId === ruleId)).toBe(true);
    await writeRepositoryFiles(cwd, {
      ".buildkite/pipeline.yml": "steps:\n  - command: echo ok\n    timeout_in_minutes: 10\n",
      ".gitlab-ci.yml": "test:\n  script: echo ok\n",
      ".circleci/config.yml": "version: 2.1\njobs:\n  test:\n    steps:\n      - run: echo ok\n",
    });
    const report = await scan(cwd);
    expect(report.workflowCount).toBe(4);
    expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(true);
    expect(report.analysisWarnings.some((w) => w.kind === "rule-error")).toBe(false);
  });

  test("reparses edited workflow files in the same process", async () => {
    const cwd = await tempDirs.create("apl-refresh-workflow-");
    await writeRepositoryFiles(cwd, { ".github/workflows/ci.yml": `on: push\n${job}` });
    expect((await scan(cwd)).findings.some((f) => f.ruleId === "missing-concurrency")).toBe(true);
    await writeRepositoryFiles(cwd, {
      ".github/workflows/ci.yml": `on: push\nconcurrency: ci\n${job}`,
    });
    expect((await scan(cwd)).findings.some((f) => f.ruleId === "missing-concurrency")).toBe(false);
  });

  test.each([
    [".github/workflows/ci.yml", `on: push\n${job.replace("npm ci", "pip install pydantic")}`],
    [".gitlab-ci.yml", "test:\n  script: pip install pydantic\n"],
    [".buildkite/pipeline.yml", "steps:\n  - command: pip install pydantic\n"],
    [
      ".circleci/config.yml",
      "version: 2.1\njobs:\n  test:\n    steps:\n      - run: pip install pydantic\n",
    ],
  ])("audits inline dependency requirements with %s", async (file, source) => {
    const cwd = await tempDirs.create("apl-repo-ci-gates-");
    await writeRepositoryFiles(cwd, {
      "pyproject.toml": '[project]\ndependencies=["pydantic==2.12.0"]\n',
      [file]: source,
    });
    const report = await analyzeRepository({
      cwd,
      targetPath: ".",
      topCount: 50,
      mode: "strict",
      repositoryOnly: true,
    });
    expect(report.findings.some((f) => f.ruleId === "outdated-pydantic-v2")).toBe(true);
    expect(report.findings.find((f) => f.ruleId === "outdated-pydantic-v2")?.workflow).toBe(file);
  });

  test.each([
    ["C:\\repo\\.circleci\\config.yml", "circleci"],
    ["C:\\repo\\.buildkite\\build.yml", "buildkite"],
    ["C:\\repo\\.gitlab-ci.yml", "gitlab-ci"],
    ["C:\\repo\\.github\\workflows\\pipeline.yml", "github-actions"],
    ["/repo/.depot/workflows/pipeline.yml", "github-actions"],
  ] as const)("classifies CI paths portably: %s", (file, kind) => {
    expect(ciKindForPath(file)).toBe(kind);
  });
});
