import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const bunRule = "prefer-setup-bun-for-lightweight-node-tooling";
const uvRule = "prefer-setup-uv-for-lightweight-python-tooling";
const installRule = "unnecessary-app-install-for-lint-job";

async function scan(jobs: Record<string, unknown>) {
  const cwd = await tempDirs.create("apl-shell-tooling-");
  await writeRepositoryFiles(cwd, {
    "package.json": '{"private":true}',
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
    ".github/workflows/ci.yml": stringify({ on: "push", jobs }),
  });
  return analyzeRepository({ cwd, targetPath: ".", mode: "exploratory", topCount: 100 });
}

function job(commands: string[], python = false) {
  return {
    "runs-on": "ubuntu-latest",
    steps: [
      { uses: python ? "actions/setup-python@v5" : "actions/setup-node@v4" },
      { run: python ? "pip install ruff" : "npm ci" },
      ...commands.map((run) => ({ name: "verify quality", run })),
    ],
  };
}

test.each([
  ["npx oxlint .", true],
  ["npm exec -- oxlint .", true],
  ["npx @biomejs/biome check .", true],
  ["echo 'npx oxlint .'", false],
  ["printf '%s' 'npx oxlint .'", false],
  ["# npx oxlint .\necho done", false],
  ['echo "$(npx oxlint .)"', true],
] as const)(
  "Node tooling needs an invocation, not a label or output: %s",
  async (command, expected) => {
    const report = await scan({ check: job([command]) });
    for (const ruleId of [bunRule, installRule]) {
      expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(expected);
    }
  },
);

test.each([
  ["ruff check .", true],
  ["python -m ruff check .", true],
  ["echo 'ruff check .'", false],
  ["printf '%s' 'ruff check .'", false],
  ["# ruff check .\necho done", false],
  ['echo "$(ruff check .)"', true],
] as const)("Python tooling needs an invocation: %s", async (command, expected) => {
  const report = await scan({ check: job([command], true) });
  expect(report.findings.some((finding) => finding.ruleId === uvRule)).toBe(expected);
});

test.each(["echo 'npm test tsc'", "printf '%s' 'nx affected'", "# npm run build"])(
  "printed heavy work does not hide actual Node tooling: %s",
  async (display) => {
    const report = await scan({ check: job(["npx oxlint .", display]) });
    for (const ruleId of [bunRule, installRule]) {
      expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(true);
    }
  },
);

test.each([
  "npm test",
  "npx jest",
  "tsc --noEmit",
  "cargo zigbuild -p oxlint",
  "cross build -p oxlint",
  "$(printf cargo) build",
  "node scripts/verify.js",
  "./scripts/check.sh",
  "/usr/bin/tsc --noEmit",
])("actual application/native work retains its guard: %s", async (command) => {
  const report = await scan({ check: job(["npx oxlint .", command]) });
  for (const ruleId of [bunRule, installRule]) {
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  }
});

test.each(["echo pytest", "printf '%s' 'python -m build'", "# tox"])(
  "printed Python work does not hide actual tooling: %s",
  async (display) => {
    const report = await scan({ check: job(["ruff check .", display], true) });
    expect(report.findings.some((finding) => finding.ruleId === uvRule)).toBe(true);
  },
);

test.each([
  "pytest",
  "python -m build",
  "poetry run pytest",
  "python scripts/check.py",
  "./scripts/check.sh",
])("actual Python application work retains its guard: %s", async (command) => {
  const report = await scan({ check: job(["ruff check .", command], true) });
  expect(report.findings.some((finding) => finding.ruleId === uvRule)).toBe(false);
});

test("filenames are not workload types", async () => {
  const report = await scan({
    node: job(["npx prettier --check tests/build.ts"]),
    python: job(["ruff check tests/build.py"], true),
  });
  expect(report.findings.some((finding) => finding.ruleId === bunRule)).toBe(true);
  expect(report.findings.some((finding) => finding.ruleId === uvRule)).toBe(true);
});

test.each([false, true])(
  "bootstrap fingerprint ignores printed corepack, not actual setup: %s",
  async (actual) => {
    const prefix = actual ? "" : "echo ";
    const report = await scan({
      first: job([`${prefix}corepack enable`]),
      second: job([`${prefix}corepack prepare`]),
    });
    expect(report.findings.some((finding) => finding.ruleId === "repeated-bootstrap-setup")).toBe(
      !actual,
    );
  },
);

test("duplicate-install scope ignores flags printed in comments", async () => {
  const report = await scan({
    check: {
      "runs-on": "ubuntu-latest",
      steps: [{ run: "npm install # --global first" }, { run: "npm install # --workspace other" }],
    },
  });
  expect(report.findings.some((finding) => finding.ruleId === "repeated-install-in-same-job")).toBe(
    true,
  );
});

test("different global install prefixes are not equivalent installs", async () => {
  const report = await scan({
    check: {
      "runs-on": "ubuntu-latest",
      steps: [
        { run: "npm install -g eslint --prefix first" },
        { run: "npm install -g eslint --prefix second" },
      ],
    },
  });
  expect(report.findings.some((finding) => finding.ruleId === "repeated-install-in-same-job")).toBe(
    false,
  );
});

test("same global package retains the registry-independent review heuristic", async () => {
  const report = await scan({
    check: {
      "runs-on": "ubuntu-latest",
      steps: [
        { run: "npm install -g verdaccio --registry http://first.invalid" },
        { run: "npm install -g verdaccio --registry http://second.invalid" },
      ],
    },
  });
  expect(report.findings.some((finding) => finding.ruleId === "repeated-install-in-same-job")).toBe(
    true,
  );
});
