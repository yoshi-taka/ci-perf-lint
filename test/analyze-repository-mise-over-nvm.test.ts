import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { preferMiseOverNvmInCiRule } from "../src/rules/prefer-mise-over-nvm-in-ci.ts";
import { assertRuleTestReport, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import {
  cleanupFixture,
  expectEveryPlatformHasFindings,
  makeEquivalentWorkflowFixtures,
} from "./cross-platform-invariance-helpers.ts";

const tempDirs = createTempDirTracker();
const ruleId = preferMiseOverNvmInCiRule.meta.id;

afterEach(async () => {
  await tempDirs.cleanup();
});

async function analyze(
  runs: string[],
  files: Record<string, string> = {},
  runner = "ubuntu-latest",
  shell?: string,
) {
  const root = await tempDirs.create("apl-mise-over-nvm-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": [
      "name: CI",
      "on: push",
      "jobs:",
      "  test:",
      `    runs-on: ${runner}`,
      "    steps:",
      ...runs.flatMap((run) => [
        `      - run: ${JSON.stringify(run)}`,
        ...(shell ? [`        shell: ${shell}`] : []),
      ]),
    ].join("\n"),
    ...files,
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    topCount: 1000,
    mode: "strict",
  });
  assertRuleTestReport(report, preferMiseOverNvmInCiRule.meta);
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test.each([
  "nvm install 24.13.0",
  "nvm install",
  "nvm install --lts",
  "nvm use",
  "nvm --silent use 24",
  "nvm exec 24 npm test",
  "nvm run 24 app.js",
  "nvm exec 24 node --version",
  "nvm run 24 app.js --help",
  'source "$NVM_DIR/nvm.sh"\nnvm install 24\nnpm ci\nnpm test',
  "CI=true nvm install 24",
  "bash -lc 'nvm install 24'",
  'sh -c "nvm use 24"',
  'printf "%s" "$(nvm use 24)"',
])("warns for executed nvm setup: %s", async (command) => {
  const findings = await analyze([command]);
  expect(findings).toHaveLength(1);
  const finding = findings[0]!;
  expect(finding.severity).toBe("warning");
  expect(finding.confidence).toBe("high");
  expect(finding.score).toBeGreaterThanOrEqual(45);
  expect(finding.docsPath).toBe("docs/rules/prefer-mise-over-nvm-in-ci.md");
  expect(finding.location.path).toBe(".github/workflows/ci.yml");
  expect(finding.location.line).toBeGreaterThan(1);
  expect(finding.suggestion).toContain("mise");
  expect(finding.aiHandoff).toContain("Node version");
});

test.each([
  "# nvm install 24\nnpm test",
  "echo 'nvm install 24'",
  "printf '%s\\n' 'nvm use 24'",
  "cat <<'EOF'\nnvm install 24\nEOF",
  "nvm --version",
  "nvm help install",
  "nvm install --help",
  "nvm install --lts --help",
  "nvm exec --help",
  "bash -lc 'echo nvm install 24'",
  "echo \"bash -lc 'nvm install 24'\"",
  "nvm ls",
  "nvm cache clear",
  "nvm.exe install 24",
  "mise install && mise exec -- npm test",
  'source "$NVM_DIR/nvm.sh"',
  "curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash",
])("does not infer nvm setup from non-setup text: %s", async (command) => {
  expect(await analyze([command])).toHaveLength(0);
});

test("does not infer CI nvm execution from repository configuration or setup-node", async () => {
  expect(
    await analyze(["npm test"], {
      ".nvmrc": "24.13.0\n",
      "README.md": "Run `nvm install` and `nvm use` locally.",
      ".github/workflows/ci.yml":
        "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v6\n        with:\n          node-version-file: .nvmrc\n      - run: npm test\n",
    }),
  ).toHaveLength(0);
});

test("reports remaining nvm even when mise is configured or used in another step", async () => {
  expect(
    await analyze(["mise install", "nvm install 24"], { "mise.toml": '[tools]\nnode = "24"\n' }),
  ).toHaveLength(1);
});

test("emits once per command entry, not once per nvm invocation", async () => {
  const findings = await analyze(["nvm install 24 && nvm use 24", "nvm exec 24 npm test"]);
  expect(findings).toHaveLength(2);
  expect(findings[0]!.location.line).not.toBe(findings[1]!.location.line);
});

test.each([
  ["windows-latest", undefined],
  ["ubuntu-latest", "pwsh"],
  ["ubuntu-latest", "python"],
])("skips unmodeled GitHub Actions shell: %s / %s", async (runner, shell) => {
  expect(await analyze(["nvm install 24"], {}, runner, shell)).toHaveLength(0);
});

test("flags explicit POSIX shell on a Windows runner", async () => {
  expect(await analyze(["nvm use 24"], {}, "windows-latest", "bash")).toHaveLength(1);
});

test("registers nvm migration advice on all four CI platforms in strict mode", async () => {
  const root = await makeEquivalentWorkflowFixtures({
    steps: ["nvm install 24.13.0", "npm test"],
  });
  try {
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      topCount: 1000,
      mode: "strict",
    });
    assertRuleTestReport(report, preferMiseOverNvmInCiRule.meta);
    expectEveryPlatformHasFindings(report.findings, ruleId);
    expect(report.findings.filter((finding) => finding.ruleId === ruleId)).toHaveLength(4);
  } finally {
    await cleanupFixture(root);
  }
});
