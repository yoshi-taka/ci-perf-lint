import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const runnerRules = new Set([
  "prefer-standard-arm-runner-for-api-cli",
  "prefer-standard-arm-runner-for-portable-tooling",
]);

async function scan(steps: Record<string, unknown>[], workflowShell?: string, jobShell?: string) {
  const cwd = await tempDirs.create("apl-execution-boundary-");
  await writeRepositoryFiles(cwd, {
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
    ".github/workflows/ci.yml": stringify({
      on: "push",
      ...(workflowShell ? { defaults: { run: { shell: workflowShell } } } : {}),
      jobs: {
        check: {
          "runs-on": "ubuntu-latest",
          ...(jobShell ? { defaults: { run: { shell: jobShell } } } : {}),
          steps,
        },
      },
    }),
  });
  return analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
}

test.each([
  "modal run eval.py",
  "harbor run --env modal",
  "harbor run --env $BACKEND",
  "ssh worker 'terraform plan'",
  "boat exec vm 'ruff check .'",
  "buildkite-agent pipeline upload ci/remote.yml",
  "./ci/check.sh",
  "bash ci/check.sh",
  "python ci/check.py",
  "node ci/check.js",
  "npm run check",
  "pnpm run check",
  "$DISPATCH check",
  "unknown-runner check",
  "eval '$COMMAND'",
  "docker exec worker pytest",
  "kubectl exec pod -- pytest",
  "make check",
])("opaque execution prevents job-wide runner advice: %s", async (command) => {
  const report = await scan([{ run: "ruff check ." }, { run: "terraform plan" }, { run: command }]);
  expect(report.findings.some((finding) => runnerRules.has(finding.ruleId))).toBe(false);
});

test.each([
  "./.github/actions/check",
  "vendor/custom-check@v1",
  "anthropics/claude-code-action@v1",
])("unexpanded actions prevent job-wide runner advice: %s", async (uses) => {
  const report = await scan([{ run: "ruff check ." }, { run: "terraform plan" }, { uses }]);
  expect(report.findings.some((finding) => runnerRules.has(finding.ruleId))).toBe(false);
});

test("visible local commands retain runner recommendations", async () => {
  const report = await scan([
    { uses: "actions/checkout@v4" },
    { run: "uvx ruff check ." },
    { run: "terraform plan" },
  ]);
  for (const ruleId of runnerRules) {
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(true);
  }
});

test("labels and quoted arguments cannot establish API CLI work", async () => {
  const report = await scan([{ name: "terraform plan", run: 'echo "terraform plan"' }]);
  expect(report.findings.some((finding) => runnerRules.has(finding.ruleId))).toBe(false);
});

test.each([
  { run: "echo 'docker build .'" },
  { run: "printf '%s\\n' 'cargo build'" },
  { run: "# docker build .\necho audit" },
  { name: "docker build .", run: "echo audit" },
  { run: "ruff check --config 'docker build .' ." },
])("display/labels/options do not suppress portable runner advice: %j", async (step) => {
  const report = await scan([{ run: "ruff check ." }, step]);
  expect(
    report.findings.some((f) => f.ruleId === "prefer-standard-arm-runner-for-portable-tooling"),
  ).toBe(true);
});

test.each([
  { run: "echo 'docker build .'" },
  { run: "# cargo build\necho audit" },
  { name: "playwright", run: "echo audit" },
  { run: "kubectl get pods --namespace 'docker build .'" },
])("data does not downgrade API runner severity: %j", async (step) => {
  const report = await scan([{ run: "kubectl get pods" }, step]);
  const finding = report.findings.find(
    (f) => f.ruleId === "prefer-standard-arm-runner-for-api-cli",
  );
  expect(finding?.severity).toBe("warning");
  const baseline = await scan([{ run: "kubectl get pods" }, { run: "echo audit" }]);
  expect(finding?.score).toBe(
    baseline.findings.find((f) => f.ruleId === "prefer-standard-arm-runner-for-api-cli")?.score,
  );
});

test("real native builds retain runner safety evidence", async () => {
  const report = await scan([
    { run: "ruff check ." },
    { run: "kubectl get pods" },
    { run: "docker build ." },
  ]);
  expect(
    report.findings.some((f) => f.ruleId === "prefer-standard-arm-runner-for-portable-tooling"),
  ).toBe(false);
  const finding = report.findings.find(
    (f) => f.ruleId === "prefer-standard-arm-runner-for-api-cli",
  );
  expect(finding?.severity).toBe("suggestion");
});

test("remote payloads do not inherit caller CPU limits", async () => {
  const report = await scan([
    { run: "ssh worker 'pytest'" },
    { run: "modal run eval.py --command pytest" },
  ]);
  expect(
    report.findings.some(
      (finding) => finding.ruleId === "missing-test-worker-tuning-for-standard-runner",
    ),
  ).toBe(false);
});

test("a custom shell cannot establish local execution", async () => {
  const report = await scan([
    { run: "ruff check .\nterraform plan\npytest", shell: "ssh worker bash {0}" },
  ]);
  expect(
    report.findings.some(
      (finding) =>
        runnerRules.has(finding.ruleId) ||
        finding.ruleId === "missing-test-worker-tuning-for-standard-runner",
    ),
  ).toBe(false);
});

test.each(["workflow", "job"])(
  "honors %s default shell and a local step override",
  async (scope) => {
    const remote = "ssh worker bash {0}";
    const args: [string | undefined, string | undefined] =
      scope === "workflow" ? [remote, undefined] : [undefined, remote];
    const report = await scan([{ run: "ruff check .\nterraform plan\npytest" }], ...args);
    expect(
      report.findings.some(
        (finding) =>
          runnerRules.has(finding.ruleId) ||
          finding.ruleId === "missing-test-worker-tuning-for-standard-runner",
      ),
    ).toBe(false);
    const local = await scan([{ run: "pytest", shell: "bash" }], ...args);
    expect(
      local.findings.some(
        (finding) => finding.ruleId === "missing-test-worker-tuning-for-standard-runner",
      ),
    ).toBe(true);
  },
);

test("mixed steps retain independently visible local test and install findings", async () => {
  const report = await scan([
    { run: "modal run eval.py" },
    { run: "pytest" },
    { run: "npm install" },
  ]);
  expect(
    report.findings.some(
      (finding) => finding.ruleId === "missing-test-worker-tuning-for-standard-runner",
    ),
  ).toBe(true);
  expect(report.findings.some((finding) => finding.ruleId === "prefer-npm-ci")).toBe(true);
});
