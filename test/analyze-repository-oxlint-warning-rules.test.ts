import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "consider-oxlint-warning-rules-off-in-ci", severity: "suggestion" } as const;

async function fixture({
  run = "bun run lint",
  lint = "oxlint src",
  config = JSON.stringify({ rules: { "no-debugger": "warn" } }),
  extra = {},
  directory = ".",
}: {
  run?: string;
  lint?: string;
  config?: string;
  extra?: Record<string, string>;
  directory?: string;
} = {}) {
  const cwd = await tempDirs.create("ci-perf-oxlint-warnings-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({
      private: true,
      devDependencies: { oxlint: "^1.88.0" },
      scripts: { lint, check: "bun run lint" },
    }),
    ".oxlintrc.json": config,
    "src/index.ts": "export const value = 1;\n",
    ".github/workflows/ci.yml": `name: CI
on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: ${JSON.stringify(run)}
        working-directory: ${JSON.stringify(directory)}
`,
    ...extra,
  });
  return cwd;
}

async function findings(options: Parameters<typeof fixture>[0] = {}) {
  const cwd = await fixture(options);
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", topCount: 100, mode: "exploratory" },
    rule,
  );
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("Oxlint warning rules in CI", () => {
  test.each(["warn", 1, ["warn", {}], [1, {}]])(
    "detects explicit severity %j",
    async (severity) => {
      const result = await findings({
        config: JSON.stringify({ rules: { "no-debugger": severity } }),
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.severity).toBe("suggestion");
      expect(result[0]?.location.path).toBe(".oxlintrc.json");
      expect(result[0]?.suggestion).toContain("logs or reports");
    },
  );

  test.each([
    "oxlint src",
    "npx oxlint src",
    "bunx oxlint src",
    "pnpm exec oxlint src",
    "bun run check",
  ])("detects CI invocation %s", async (run) => {
    expect(await findings({ run })).toHaveLength(1);
  });

  test.each([
    "--help",
    "-h",
    "--version",
    "-V",
    "--deny-warnings",
    "--max-warnings=0",
    "--max-warnings 10",
    "--fix",
    "--fix-suggestions",
    "--fix-dangerously",
    "--format json",
    "-f json",
    "--config custom.json",
    "-c custom.json",
    "-D all",
    "--allow all",
    "--print-config",
  ])("preserves intentional warning/config behavior: %s", async (flag) => {
    expect(await findings({ lint: `oxlint ${flag} src` })).toHaveLength(0);
  });

  test.each(["--quiet", "--silent", "--quiet --silent"])(
    "detects hidden warnings that still execute: %s",
    async (flag) => {
      const result = await findings({ lint: `oxlint ${flag} src` });
      expect(result).toHaveLength(1);
      expect(result[0]?.why).toContain("do not skip warning-rule execution");
      expect(result[0]?.suggestion).toContain("process.env.CI");
      expect(result[0]?.aiHandoff).toContain(
        "Preserve rule options, error rules and local warnings",
      );
    },
  );

  test.each(["oxlint --quiet src", "bunx oxlint --silent src", "bun run check"])(
    "detects direct or nested hidden-warning invocation: %s",
    async (run) => {
      expect(await findings({ run, lint: "oxlint --quiet src" })).toHaveLength(1);
    },
  );

  test.each([
    "--quiet --deny-warnings",
    "--silent --max-warnings=0",
    "--quiet --fix",
    "--silent --format json",
    "--quiet -c custom.json",
  ])("preserves gates/fixes/reports even with hidden warnings: %s", async (flag) => {
    expect(await findings({ lint: `oxlint ${flag} src` })).toHaveLength(0);
  });

  test("does not report rules already off when output is hidden", async () => {
    expect(
      await findings({ lint: "oxlint --quiet src", config: '{"rules":{"no-debugger":"off"}}' }),
    ).toHaveLength(0);
  });

  test.each([
    "echo oxlint",
    "echo 'oxlint src'",
    "cd app && oxlint src",
    "oxlint $FILES",
    "bun run lint -- --deny-warnings",
    "bun --cwd app run lint",
    "echo done # oxlint src",
  ])("does not infer uncertain execution: %s", async (run) => {
    expect(await findings({ run })).toHaveLength(0);
  });

  test.each(["warn", 1])("detects warning category severity %j", async (severity) => {
    const result = await findings({
      config: JSON.stringify({ categories: { correctness: "error", perf: severity } }),
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain("category");
  });

  test.each([
    {},
    { rules: { "no-debugger": "error" } },
    { rules: { "no-debugger": "off" } },
    { categories: { correctness: "error" } },
    { rules: { "no-debugger": "warn" }, options: { denyWarnings: true } },
    { rules: { "no-debugger": "warn" }, extends: ["./base.json"] },
    { rules: { "no-debugger": "warn" }, overrides: [] },
  ])("skips unsupported or non-warning config %j", async (config) => {
    expect(await findings({ config: JSON.stringify(config) })).toHaveLength(0);
  });

  test("skips malformed config", async () => {
    expect(await findings({ config: "{ broken" })).toHaveLength(0);
  });

  test.each(["oxlint.config.ts", "oxlint.config.mts", ".oxlintrc.jsonc"])(
    "does not execute or guess config %s",
    async (file) => {
      expect(
        await findings({ extra: { [file]: "throw new Error('must not execute');" } }),
      ).toHaveLength(0);
    },
  );

  test("requires root working directory", async () => {
    expect(await findings({ directory: "app" })).toHaveLength(0);
  });

  test("does not follow recursive scripts", async () => {
    expect(await findings({ lint: "bun run check" })).toHaveLength(0);
  });

  test("is excluded from strict mode", async () => {
    const cwd = await fixture();
    const report = await analyzeRepository({ cwd, targetPath: ".", topCount: 100 });
    expect(report.findings.some((finding) => finding.ruleId === rule.id)).toBe(false);
  });
});
