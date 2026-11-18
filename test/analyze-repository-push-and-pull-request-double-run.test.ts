import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import {
  createTempDirTracker,
  getWorkflowFocusedFixtureReport,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const options = { targetPath: ".", topCount: 100, mode: "exploratory" as const };

async function analyzeWorkflow(
  workflow: Record<string, unknown>,
  files: Record<string, string> = {},
) {
  const root = await tempDirs.create("apl-double-run-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": stringify(workflow),
    ...files,
  });
  const report = await analyzeRepository({ cwd: root, ...options });
  return report.findings;
}

const heavyJob = {
  "runs-on": "ubuntu-latest",
  steps: [
    { uses: "actions/checkout@v7" },
    { uses: "oven-sh/setup-bun@v2", with: { "bun-version": "1.4.4" } },
    { run: "bun install --frozen-lockfile" },
    { run: "bun run typecheck" },
    { run: "bun run test" },
  ],
};

const ruleId = "push-and-pull-request-double-run";

describe(ruleId, () => {
  test("flags an unfiltered push beside pull_request", async () => {
    const findings = await analyzeWorkflow({
      name: "CI",
      on: { push: null, pull_request: null },
      jobs: { build: heavyJob },
    });
    const matches = findings.filter((finding) => finding.ruleId === ruleId);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.message).toContain("runs it twice");
  });

  test("fires in strict mode too", async () => {
    const root = await tempDirs.create("apl-double-run-strict-");
    await writeRepositoryFiles(root, {
      ".github/workflows/ci.yml": stringify({
        name: "CI",
        on: { push: null, pull_request: null },
        jobs: { build: heavyJob },
      }),
    });
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 100,
      mode: "strict",
    });
    expect(
      report.findings.filter(
        (finding) => finding.ruleId === ruleId && finding.severity === "warning",
      ),
    ).toHaveLength(1);
  });

  test.each([
    ["branches-scoped push", { push: { branches: ["main"] }, pull_request: null }],
    ["tag-only push", { push: { tags: ["v*"] }, pull_request: null }],
    ["push-only", { push: null }],
    ["pull_request-only", { pull_request: null }],
  ])("exempts a %s", async (_name, on) => {
    const findings = await analyzeWorkflow({ name: "CI", on, jobs: { build: heavyJob } });
    expect(findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(0);
  });

  test("paths filters do not deduplicate and the rule still fires", async () => {
    const findings = await analyzeWorkflow({
      name: "CI",
      on: {
        push: { "paths-ignore": ["docs/**"] },
        pull_request: { "paths-ignore": ["docs/**"] },
      },
      jobs: { build: heavyJob },
    });
    expect(findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(1);
  });

  test("branches-ignore without branches still reports", async () => {
    const findings = await analyzeWorkflow({
      name: "CI",
      on: { push: { "branches-ignore": ["gh-pages"] }, pull_request: null },
      jobs: { build: heavyJob },
    });
    expect(findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(1);
  });

  test("light workflows are not flagged", async () => {
    const findings = await analyzeWorkflow({
      name: "Notice",
      on: { push: null, pull_request: null },
      jobs: {
        notice: { "runs-on": "ubuntu-latest", steps: [{ run: "echo hello" }] },
      },
    });
    expect(findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(0);
  });

  test("meta-check workflows are not flagged", async () => {
    const findings = await analyzeWorkflow({
      name: "Labeler",
      on: { push: null, pull_request: null },
      jobs: {
        label: {
          "runs-on": "ubuntu-latest",
          steps: [{ uses: "actions/labeler@v5" }],
        },
      },
    });
    expect(findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(0);
  });

  test("fixture baseline fires and the scoped fixture stays silent", async () => {
    const like = await getWorkflowFocusedFixtureReport(
      fixtures.pushAndPullRequestDoubleRunLike,
      options,
    );
    expect(like.findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(1);
    const ok = await getWorkflowFocusedFixtureReport(
      fixtures.pushAndPullRequestDoubleRunOk,
      options,
    );
    expect(ok.findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(0);
  });
});
