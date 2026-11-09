import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { parseWorkflow } from "../src/workflow.ts";
import { getJobFacts, getWorkflowFacts } from "../src/rules/shared/workflow-analysis.ts";
import { declaredShellEnvironmentNames } from "../src/rules/shared/shell-environment-evidence.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const timeoutRule = "missing-timeout-minutes";
const sparseRule = "prefer-sparse-checkout-for-scoped-workflow";

async function scan(
  steps: Record<string, unknown>[],
  name = "Checks",
  trigger = "push",
  jobId = "verify",
) {
  const cwd = await tempDirs.create("apl-work-context-evidence-");
  const source = stringify({
    name,
    on: trigger,
    jobs: { [jobId]: { "runs-on": "ubuntu-latest", steps } },
  });
  await writeRepositoryFiles(cwd, { ".github/workflows/ci.yml": source });
  const workflow = parseWorkflow(`${cwd}/.github/workflows/ci.yml`, cwd, source);
  getWorkflowFacts(workflow);
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 1000,
  });
  return { report, facts: getJobFacts(workflow.jobs[0]!) };
}

describe("timeout workload evidence", () => {
  test.each([
    "echo 'claude review'",
    "printf '%s\\n' 'codex exec review'",
    "# claude review\necho audit",
    "echo '$(claude review)'",
    "grep 'claude review' README.md",
    "cat 'build notes.txt'",
    "cat notes.txt 'pytest'",
    "curl -H 'build' https://example.com",
    "git -c 'alias.foo=claude' status",
    "echo 'npm run build'",
    "/bin/echo build",
    "REGEX='claude|build|pytest'",
  ])("does not turn data into workload or agentic execution: %s", async (run) => {
    const { report, facts } = await scan([{ run }]);
    expect(report.findings.some((f) => f.ruleId === timeoutRule)).toBe(false);
    expect(facts.hasDirectHeavySignals).toBe(false);
    expect(facts.looksAgenticLike).toBe(false);
  });

  test.each(["echo 'claude review'", "# claude review\necho audit", "grep 'codex exec' README.md"])(
    "logs do not upgrade a real lint job: %s",
    async (run) => {
      const { report, facts } = await scan(
        [{ run: "pip install ruff" }, { run: "ruff check ." }, { run }],
        "Lint",
        "push",
        "lint",
      );
      const finding = report.findings.find((f) => f.ruleId === timeoutRule);
      expect(finding?.severity).toBe("suggestion");
      expect(finding?.why).not.toContain("AI-assisted");
      expect(facts.looksAgenticLike).toBe(false);
    },
  );

  test.each(["claude review", "npx @openai/codex exec review", 'echo "$(claude review)"'])(
    "retains executable agent evidence: %s",
    async (run) => {
      const { report } = await scan([{ run }]);
      const finding = report.findings.find((f) => f.ruleId === timeoutRule);
      expect(finding?.severity).toBe("warning");
      expect(finding?.why).toContain("AI-assisted");
    },
  );

  test.each([
    "npm run test:unit",
    "pnpm --filter app run build",
    "uv run pytest",
    "sudo -n pip install ruff",
    "node scripts/build.mjs",
  ])("retains real tool/task evidence: %s", async (run) => {
    const { report, facts } = await scan([{ run }]);
    expect(report.findings.some((f) => f.ruleId === timeoutRule)).toBe(true);
    expect(facts.hasDirectHeavySignals).toBe(true);
  });

  test("keeps a meaningful make label as intent alongside real execution", async () => {
    const { report } = await scan([{ name: "Build", run: "make all" }]);
    expect(report.findings.some((f) => f.ruleId === timeoutRule)).toBe(true);
  });

  test("a label alone on a display step is not executable agent evidence", async () => {
    const { report } = await scan([{ name: "Claude review", run: "echo audit" }]);
    expect(report.findings.some((f) => f.ruleId === timeoutRule)).toBe(false);
  });

  test.each(["echo audit\necho done", "grep build notes.txt\ngrep test notes.txt"])(
    "multiple data commands cannot activate a build label: %s",
    async (run) => {
      const { report, facts } = await scan([{ name: "Build", run }]);
      expect(report.findings.some((f) => f.ruleId === timeoutRule)).toBe(false);
      expect(facts.hasDirectHeavySignals).toBe(false);
    },
  );

  test("environment writes retain their meaning without proving a build workload", async () => {
    const run =
      'echo "DOCKER_IMAGE_TAG=${{ needs.build.outputs.docker_image_tag }}" >> $GITHUB_ENV\necho "LINK_TO_RUN=${{ needs.build.outputs.LINK_TO_RUN }}" >> $GITHUB_ENV';
    const { report, facts } = await scan(
      [{ name: "Set environment variables from build output", run }],
      "Checks",
      "push",
      "post_deployment",
    );
    expect(report.findings.some((f) => f.ruleId === timeoutRule)).toBe(false);
    expect(facts.hasDirectHeavySignals).toBe(false);
    expect(declaredShellEnvironmentNames(run)).toEqual(
      new Set(["DOCKER_IMAGE_TAG", "LINK_TO_RUN"]),
    );
  });

  test("retains structured agent actions on comment triggers", async () => {
    const { report } = await scan(
      [{ uses: "anthropics/claude-code-action@v1", with: { prompt: "Review changes" } }],
      "Checks",
      "issue_comment",
    );
    expect(report.findings.find((f) => f.ruleId === timeoutRule)?.severity).toBe("warning");
  });

  test.each([
    { run: "echo 'build'" },
    { run: "# build\necho audit" },
    { run: "cat 'build notes.txt'" },
    { name: "Build", run: "echo audit" },
    { run: "echo '$(npm run build)'" },
  ])("a timed data step is not heavy-step timeout coverage: %j", async (step) => {
    const { report } = await scan(
      [{ run: "npm ci" }, { ...step, "timeout-minutes": 1 }],
      "Release",
    );
    const finding = report.findings.find((f) => f.ruleId === timeoutRule);
    expect(finding?.severity).toBe("warning");
    expect(finding?.why).not.toContain("already times out");
  });

  test.each([
    { run: "npm run build" },
    { run: 'echo "$(npm run build)"' },
    { name: "Build", run: "make all" },
    { uses: "actions/upload-artifact@v4", with: { path: "dist" } },
  ])("retains real heavy-step timeout coverage: %j", async (step) => {
    const { report } = await scan(
      [{ run: "npm ci" }, { ...step, "timeout-minutes": 1 }],
      "Release",
    );
    const finding = report.findings.find((f) => f.ruleId === timeoutRule);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.why).toContain("already times out");
  });
});

describe("sparse checkout safety evidence", () => {
  const steps = [
    { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
    { run: "cat packages/app/version.txt" },
  ];

  test.each([
    "echo audit",
    "echo 'npm ci'",
    "# npm ci\necho audit",
    "printf '%s\\n' 'lint'",
    "# typecheck\necho audit",
    "echo 'claude review'",
    "# claude review\necho audit",
    "echo '$(npm ci)'",
    "grep 'npm install' notes.txt",
    "cat 'lint notes.txt'",
  ])("data cannot supply install/quality/agentic exclusions: %s", async (run) => {
    const { report } = await scan([...steps, { run }], "Release", "push", "publish");
    expect(report.findings.some((f) => f.ruleId === sparseRule)).toBe(true);
  });

  test.each([
    { run: "npm ci" },
    { run: "pnpm --filter app install" },
    { run: 'echo "$(npm ci)"' },
    { run: "npm run lint" },
    { run: "claude review" },
    { run: "npx @openai/codex exec review" },
    { run: 'echo "$(claude review)"' },
    {
      uses: "anthropics/claude-code-action@v1",
      with: { prompt: "Update docs from changed files" },
    },
    { name: "test", run: "echo audit" },
    { run: "git -c 'alias.foo=npm ci' status" },
    { run: "bash scripts/check.sh" },
    { run: "echo audit", shell: "python" },
  ])("retains real work, explicit intent and opaque execution exclusions: %j", async (step) => {
    const { report } = await scan([...steps, step], "Release", "push", "publish");
    expect(report.findings.some((f) => f.ruleId === sparseRule)).toBe(false);
  });
});
