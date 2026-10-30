import { afterEach, describe, expect, test } from "bun:test";
import {
  createTempDirTracker,
  getWorkflowFocusedFixtureReport,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

async function timeoutFindings(trigger: string, jobs: string) {
  const cwd = await tempDirs.create("apl-agentic-timeout-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/automation.yml": `${trigger}\njobs:\n${jobs}\n`,
  });
  const report = await getWorkflowFocusedFixtureReport(cwd, {
    targetPath: ".",
    topCount: 100,
    mode: "exploratory",
  });
  return report.findings.filter((finding) => finding.ruleId === "missing-timeout-minutes");
}

const aiJob = [
  "  assistant:",
  "    runs-on: ubuntu-latest",
  "    if: contains(github.event.comment.body, '@claude')",
  "    steps:",
  "      - uses: anthropics/claude-code-action@v1",
].join("\n");

describe("comment/review-triggered AI job timeouts", () => {
  test.each([
    "on: issue_comment",
    "on: [pull_request_review_comment]",
    "on:\n  pull_request_review:\n    types: [submitted]",
    "on:\n  issue_comment:\n    types: [created]\n  workflow_dispatch:",
  ])("warns for an unbounded AI job with %s", async (trigger) => {
    const findings = await timeoutFindings(trigger, aiJob);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain('Job "assistant"');
    expect(findings[0]?.why).toContain("AI-assisted job");
  });

  test("does not include a non-AI heavy sibling job", async () => {
    const findings = await timeoutFindings(
      "on: issue_comment",
      `${aiJob}\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run build`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('Job "assistant"');
  });

  test("detects an AI CLI command without an AI job name", async () => {
    const findings = await timeoutFindings(
      "on: issue_comment",
      "  automation:\n    runs-on: ubuntu-latest\n    steps:\n      - run: codex exec 'Review this PR'",
    );
    expect(findings).toHaveLength(1);
  });

  test.each([
    aiJob.replace("    runs-on:", "    timeout-minutes: 20\n    runs-on:"),
    aiJob.replace("contains(github.event.comment.body, '@claude')", "false"),
    "  assistant:\n    uses: example/repo/.github/workflows/claude.yml@main",
    "  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run build",
  ])("skips bounded, disabled, reusable, or non-AI jobs: %s", async (jobs) => {
    expect(await timeoutFindings("on: issue_comment", jobs)).toEqual([]);
  });

  test.each([
    "on: workflow_dispatch",
    "on:\n  schedule:\n    - cron: '0 0 * * *'",
    "on:\n  workflow_run:\n    workflows: [CI]\n    types: [completed]",
  ])("preserves the existing exclusion for %s", async (trigger) => {
    expect(await timeoutFindings(trigger, aiJob)).toEqual([]);
  });
});
