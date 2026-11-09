import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const sparseRule = "prefer-sparse-checkout-for-scoped-workflow";
const circleRule = "circleci-checkout-uses-full-clone";

async function scan(file: string, config: unknown) {
  const cwd = await tempDirs.create("apl-checkout-audit-");
  await writeRepositoryFiles(cwd, {
    [file]: stringify(config),
    "scripts/version.sh": "#!/bin/sh\ngit log --oneline\n",
  });
  return analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "exploratory",
    workflowOnly: true,
    topCount: 100,
  });
}

async function sparse(run: string, extra: Record<string, unknown>[] = []) {
  return scan(".github/workflows/ci.yml", {
    name: "Release",
    on: "push",
    jobs: {
      publish: {
        "runs-on": "ubuntu-latest",
        steps: [
          { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
          { run: "git log --oneline" },
          { run },
          ...extra,
        ],
      },
    },
  });
}

test.each([
  ["echo 'packages/app'", false],
  ["printf '%s' 'packages/app'", false],
  ["# cd packages/app\necho done", false],
  ["echo 'cd packages/app'", false],
  ["gh api -f message=packages/app repos/org/repo/issues", false],
  ["grep packages/app output.log", false],
  ["echo '$(cat packages/app/version.txt)'", false],
  ["cat packages/app/version.txt", true],
  ["cd packages/app", true],
  ['echo "$(cat packages/app/version.txt)"', true],
  ["git describe --tags > packages/app/version.txt", true],
  ["echo 'version' > packages/app/version.txt", true],
  ["echo 'version > packages/app/version.txt'", false],
  ["cat packages/*/version.txt", false],
  ["cat packages/app/../../other/version.txt", false],
  ["cat $OUTPUT_DIR/packages/app/version.txt", false],
] as const)("sparse scope needs path operands, not displayed text: %s", async (run, expected) => {
  const report = await sparse(run);
  expect(report.findings.some((f) => f.ruleId === sparseRule)).toBe(expected);
});

test.each([
  ["find . -type f", false],
  ["find .", false],
  ["find", false],
  ["fd .", false],
  ["rg --files", false],
  ["git grep version", false],
  ["ls -R", false],
  ["echo 'find . -type f'", true],
  ["printf '%s' 'fd .'", true],
  ["# find . -type f\necho done", true],
  ['echo "$(find . -type f)"', false],
] as const)("wide scans override a visible narrow path: %s", async (run, expected) => {
  const report = await sparse(run, [
    { uses: "actions/upload-artifact@v4", with: { path: "packages/app/version.txt" } },
  ]);
  expect(report.findings.some((f) => f.ruleId === sparseRule)).toBe(expected);
});

test("audit reproducer cannot invent scope even when find traverses the tree", async () => {
  const report = await sparse("echo 'packages/app'\nfind . -type f");
  expect(report.findings.some((f) => f.ruleId === sparseRule)).toBe(false);
});

test("actual redirect owns the scope, not the text written to it", async () => {
  const report = await sparse("echo 'packages/fake' > packages/actual/version.txt");
  const finding = report.findings.find((f) => f.ruleId === sparseRule);
  expect(finding?.why).toContain('"packages/actual"');
  expect(finding?.why).not.toContain("packages/fake");
});

test.each([
  [{ uses: "actions/upload-artifact@v4", with: { path: "packages/app/dist/*" } }, true],
  [{ uses: "vendor/custom-action@v1", with: { path: "packages/app" } }, false],
  [{ run: "git log", "working-directory": "packages/app" }, true],
] as const)("modeled structured paths remain valid scope: %j", async (step, expected) => {
  const report = await sparse("echo done", [step]);
  expect(report.findings.some((f) => f.ruleId === sparseRule)).toBe(expected);
});

async function circle(run: unknown, extraSteps: unknown[] = [], job: Record<string, unknown> = {}) {
  return scan(".circleci/config.yml", {
    version: 2.1,
    jobs: {
      check: {
        docker: [{ image: "cimg/base:stable" }],
        ...job,
        steps: [{ checkout: { method: "full" } }, { run }, ...extraSteps],
      },
    },
  });
}

test.each([
  ["echo audit", true],
  ["npm ci\nnpm test", true],
  ["git log --oneline", false],
  ["sudo -n git -C repo log", false],
  ["echo 'git log --oneline'", true],
  ["printf '%s' 'git log'", true],
  ["# git log\necho done", true],
  ['echo "$(git log)"', false],
  ["echo '$(git log)'", true],
  ["bash scripts/version.sh", false],
  ["./scripts/version.sh", false],
  ["node scripts/version.js", false],
  ['eval "$COMMAND"', false],
  ["cat <<EOF\ncommands\nEOF", false],
  ["echo 'unterminated", false],
  ["echo $((1 + 2))", false],
] as const)(
  "CircleCI separates visible metadata from logs and opaque execution: %s",
  async (run, expected) => {
    const report = await circle(run);
    const finding = report.findings.find((f) => f.ruleId === circleRule);
    expect(Boolean(finding)).toBe(expected);
    if (finding) {
      expect(finding.suggestion).toContain("Keep the checkout step");
      expect(finding.suggestion).not.toContain("Remove checkout");
      expect(finding.message).not.toContain("does not need git history");
      expect(finding.why).toContain("retains commit and tree metadata");
    }
  },
);

test.each([
  ["python", false],
  ["custom-shell {0}", false],
  ["/bin/bash -eo pipefail", true],
] as const)("CircleCI custom shell guard: %s", async (shell, expected) => {
  const report = await circle({ command: "echo audit", shell });
  expect(report.findings.some((f) => f.ruleId === circleRule)).toBe(expected);
});

test.each([
  "my_orb/hidden-command",
  { "my_orb/hidden-command": {} },
  { when: { condition: true, steps: [{ run: "bash scripts/version.sh" }] } },
])("CircleCI unresolved commands do not prove clone-mode safety: %j", async (step) => {
  const report = await circle("echo audit", [step]);
  expect(report.findings.some((f) => f.ruleId === circleRule)).toBe(false);
});

test("CircleCI unresolved executor shell cannot establish clone-mode safety", async () => {
  const report = await circle("echo audit", [], { executor: "my_orb/windows" });
  expect(report.findings.some((f) => f.ruleId === circleRule)).toBe(false);
});
