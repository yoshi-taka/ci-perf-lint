import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const artifactRule = "unnecessary-checkout-when-only-using-artifacts";
const blobRule = "consider-filter-blob-none-for-release-metadata";

async function scan(
  steps: Record<string, unknown>[],
  job: Record<string, unknown> = {},
  root: Record<string, unknown> = {},
) {
  const cwd = await tempDirs.create("apl-shell-checkout-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      on: "push",
      ...root,
      jobs: {
        check: { "runs-on": "ubuntu-latest", ...job, steps },
      },
    }),
  });
  return analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "exploratory",
    workflowOnly: true,
    topCount: 100,
  });
}

test.each([
  ["echo 'npm ci && make build && git apply patch.diff'", true],
  ["printf '%s' 'git log && ./scripts/check.sh && cat package.json'", true],
  ["# git log && scripts/check.sh\necho done", true],
  ["echo 'echo done > report.md'", true],
  ["make build", false],
  ["git apply patch.diff", false],
  ["npm ci", false],
  ["pnpm --filter app exec jest", false],
  ["git log", false],
  ["./scripts/check.sh", false],
  ["cat package.json", false],
  ['echo "$(git log)"', false],
  ['echo "$(./scripts/check.sh)"', false],
  ["echo '$(./scripts/check.sh)'", true],
  ["echo done > report.md", false],
  ["printf '%s' x >> .git/config", false],
  ['eval "$COMMAND"', false],
  ["custom-helper", false],
  ["cat <<EOF\nwork\nEOF", false],
  ["echo 'unterminated", false],
  ['echo "$(echo $((1 + 2)))"', false],
  ["diff <(tar tzf before.tgz) <(tar tzf after.tgz)", true],
  ['echo "X=value" >> "$GITHUB_ENV"', true],
] as const)(
  "artifact-only proof ignores logs but retains executed/unknown work: %s",
  async (run, expected) => {
    const report = await scan([
      { uses: "actions/checkout@v4" },
      { uses: "actions/download-artifact@v4" },
      { name: "make build / git log / scripts/test.sh", run },
    ]);
    expect(report.findings.some((f) => f.ruleId === artifactRule)).toBe(expected);
  },
);

test("multiple checkouts do not make an opaque repository helper safe to narrow", async () => {
  const report = await scan([
    { uses: "actions/checkout@v4" },
    { run: ".github/scripts/use-cla-approved-bot.sh" },
    { uses: "actions/checkout@v4", with: { ref: "cloudfoundry" } },
    { run: "git push origin HEAD" },
  ]);
  expect(
    report.findings.some((f) => f.ruleId === "prefer-sparse-checkout-for-scoped-workflow"),
  ).toBe(false);
});

test.each([
  ["git log --oneline", false],
  ["echo 'git log --oneline'", true],
  ["printf '%s' 'scripts/test.sh'", true],
  ["# scripts/test.sh\necho done", true],
  ["./scripts/test.sh", false],
  ['echo "$(./scripts/test.sh)"', false],
  ["echo $((1 + 2))", false],
] as const)(
  "shared history/opaque facts distinguish execution from display: %s",
  async (run, expected) => {
    const report = await scan([
      { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
      { run: "npm ci" },
      { run },
    ]);
    expect(report.findings.some((f) => f.ruleId === "deep-checkout-without-need")).toBe(expected);
  },
);

test.each([0, 2000])(
  "workflow-default custom shell prevents shallow-history claims: %s",
  async (depth) => {
    const report = await scan(
      [
        { uses: "actions/checkout@v4", with: { "fetch-depth": depth } },
        { run: "npm ci", shell: "bash" },
        { run: "echo done" },
      ],
      {},
      { defaults: { run: { shell: "custom-shell {0}" } } },
    );
    expect(
      report.findings.some(
        (f) =>
          f.ruleId === "deep-checkout-without-need" || f.ruleId === "deep-checkout-excessive-depth",
      ),
    ).toBe(false);
  },
);

test.each(["step", "job", "workflow"])(
  "custom %s shell does not prove artifact-only work",
  async (level) => {
    const defaults = { run: { shell: "python" } };
    const report = await scan(
      [
        { uses: "actions/checkout@v4" },
        { uses: "actions/download-artifact@v4" },
        { run: "print('done')", ...(level === "step" ? { shell: "python" } : {}) },
      ],
      level === "job" ? { defaults } : {},
      level === "workflow" ? { defaults } : {},
    );
    expect(report.findings.some((f) => f.ruleId === artifactRule)).toBe(false);
  },
);

test("unknown actions may consume repository configuration", async () => {
  const report = await scan([
    { uses: "actions/checkout@v4" },
    { uses: "actions/download-artifact@v4" },
    { uses: "vendor/custom-helper@v1" },
  ]);
  expect(report.findings.some((f) => f.ruleId === artifactRule)).toBe(false);
});

test.each([undefined, "bash"])(
  "Windows default shell is not assumed to be POSIX: %s",
  async (shell) => {
    const report = await scan(
      [
        { uses: "actions/checkout@v4" },
        { uses: "actions/download-artifact@v4" },
        { run: "echo done", ...(shell ? { shell } : {}) },
      ],
      { "runs-on": "windows-latest" },
    );
    expect(report.findings.some((f) => f.ruleId === artifactRule)).toBe(shell === "bash");
  },
);

test("known artifact actions retain metadata-only blob filtering guidance", async () => {
  const report = await scan([
    { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
    { run: "git describe --tags > packages/app/version.txt" },
    { uses: "actions/upload-artifact@v4", with: { path: "packages/app/version.txt" } },
  ]);
  expect(report.findings.some((f) => f.ruleId === blobRule)).toBe(true);
});

test.each([
  ["echo 'find . -type f'", true],
  ["printf '%s' 'npm ci && npm run build'", true],
  ["# cargo build\necho done", true],
  ["echo 'yarn release:publish'", true],
  ["echo 'claude update docs'", true],
  ["find . -type f", false],
  ["rg --files", false],
  ["fd .", false],
  ["npm ci", false],
  ["pnpm --filter app run build", false],
  ["pnpm --filter app exec jest", false],
  ["pnpm --filter app exec bash scripts/test.sh", false],
  ["yarn release:publish", false],
  ["gh api -f message='find . / npm ci / yarn release:publish' repos/org/repo/issues", true],
  ["claude 'update docs'", false],
  ["bash scripts/release.sh", false],
  ["cat <<EOF\nwork\nEOF", false],
  ["echo 'unterminated", false],
  ['echo "$(npm run build)"', false],
  ['echo "$(find . -type f)"', false],
] as const)(
  "blob:none safety exclusions use actual work, not logged warnings: %s",
  async (run, expected) => {
    const report = await scan([
      { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
      { run: "git log --oneline" },
      { name: "build publish / find . / claude update docs", run },
    ]);
    expect(report.findings.some((f) => f.ruleId === blobRule)).toBe(expected);
  },
);

test.each([
  { uses: "vendor/custom-helper@v1" },
  { uses: "./.github/actions/release" },
  { uses: "vendor/release-please@v1", with: { "install-code-deps": true } },
  { run: "echo done", shell: "python" },
] as const)("blob:none retains unknown/structured safeguards: %j", async (step) => {
  const report = await scan([
    { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
    { run: "git log" },
    step,
  ]);
  expect(report.findings.some((f) => f.ruleId === blobRule)).toBe(false);
});
