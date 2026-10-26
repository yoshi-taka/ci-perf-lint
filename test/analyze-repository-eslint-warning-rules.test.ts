import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "consider-eslint-warning-rules-off-in-ci", severity: "suggestion" } as const;

async function fixture({
  version = "^10.0.0",
  run = "bun run lint",
  lint = "eslint src",
  config = 'export default [{ rules: { "no-debugger": "warn" } }];',
  file = "eslint.config.js",
  directory = ".",
  extra = {},
}: {
  version?: string;
  run?: string;
  lint?: string;
  config?: string;
  file?: string;
  directory?: string;
  extra?: Record<string, string>;
} = {}) {
  const cwd = await tempDirs.create("ci-perf-eslint-quiet-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({
      private: true,
      devDependencies: { eslint: version },
      scripts: { lint, check: "bun run lint" },
    }),
    [file]: config,
    "src/index.js": "export const value = 1;\n",
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

describe("ESLint warning rules in CI", () => {
  test.each(["9.0.0", "^9.39.0", "^10.0.0"])("quiet is not default on %s", async (version) => {
    const result = await findings({ version });
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("suggestion");
    expect(result[0]?.suggestion).toContain("markVariableAsUsed");
  });

  test.each(["^8.57.0", "^7.0.0", "latest", "workspace:*"])(
    "skips unsupported old flat-config opt-in or unknown version %s",
    async (version) => {
      expect(await findings({ version })).toHaveLength(0);
    },
  );

  test.each(["warn", 1, ["warn", {}], [1, {}]])("explicit severity %j", async (severity) => {
    expect(
      await findings({
        config: `export default [{ rules: { "no-debugger": ${JSON.stringify(severity)} } }];`,
      }),
    ).toHaveLength(1);
  });

  test.each([
    "eslint src",
    "npx eslint src",
    "bunx eslint src",
    "pnpm exec eslint src",
    "bun run check",
  ])("recognizes %s", async (run) => {
    expect(await findings({ run })).toHaveLength(1);
  });

  test.each([
    "--quiet",
    "--max-warnings=0",
    "--max-warnings 10",
    "--max-warnings=-1",
    "--quiet --max-warnings=0",
    "--fix",
    "--fix-dry-run",
    "--fix-type problem",
    "--format json",
    "-f json",
    "--output-file eslint.json",
    "-o eslint.json",
    "--config other.js",
    "-c other.js",
    "--no-config-lookup",
    "--rule no-debugger:error",
    "--help",
    "--version",
    "--print-config src/index.js",
    "--suppress-all",
  ])("preserves warning consumers and nonstandard invocations %s", async (flag) => {
    expect(await findings({ lint: `eslint ${flag} src` })).toHaveLength(0);
  });

  test.each([
    "echo eslint",
    "echo 'eslint src'",
    "cd app && eslint src",
    "eslint $FILES",
    "bun run lint -- --max-warnings=0",
    "bun --cwd app run lint",
    "bun run check -- --quiet",
    "ESLINT_USE_FLAT_CONFIG=false eslint src",
    "echo done # eslint src",
  ])("skips uncertain command %s", async (run) => {
    expect(await findings({ run })).toHaveLength(0);
  });

  test.each(["eslint.config.mjs", "eslint.config.ts", "eslint.config.mts", "eslint.config.cts"])(
    "supports literal config %s",
    async (file) => {
      expect(await findings({ file })).toHaveLength(1);
    },
  );

  test("supports CommonJS flat config", async () => {
    expect(
      await findings({
        file: "eslint.config.cjs",
        config: 'module.exports = [{rules: {"no-debugger": "warn"}}];',
      }),
    ).toHaveLength(1);
  });

  test("supports defineConfig alias and nested arrays", async () => {
    expect(
      await findings({
        config:
          'import {defineConfig as config} from "eslint/config"; export default config([{rules: {"no-debugger": "warn"}}], [{rules: {eqeqeq: 1}}]);',
      }),
    ).toHaveLength(1);
  });

  test("later literal severity overrides warning", async () => {
    expect(
      await findings({
        config:
          'export default [{rules: {"no-debugger": "warn"}}, {rules: {"no-debugger": "error"}}];',
      }),
    ).toHaveLength(0);
  });

  test.each([
    'export default [{rules: {"no-debugger": "error"}}];',
    'export default []; // rules: {"no-debugger": "warn"}',
    'export default [{name: \'rules: {"no-debugger": "warn"}\'}];',
    'import js from "@eslint/js"; export default [js.configs.recommended, {rules: {"no-debugger": "warn"}}];',
    'const config = [{rules: {"no-debugger": "warn"}}]; export default config;',
    'export default [{files: ["**/*.js"], rules: {"no-debugger": "warn"}}];',
    'export default [{rules: {"no-debugger": "warn"}}, ...other];',
    'export default [{rules: {"no-debugger": "warn", ...other}}];',
    'export default [{rules: {"no-debugger": "warn"}, extends: [other]}];',
    'export default [{rules: {[name]: "warn"}}];',
    'export default [{rules: {"no-debugger": level}}];',
    'throw new Error("must not execute"); export default [{rules: {"no-debugger": "warn"}}];',
    "export default broken syntax",
  ])("does not guess config %s", async (config) => {
    expect(await findings({ config })).toHaveLength(0);
  });

  test("does not infer flat config from legacy config on ESLint 10", async () => {
    expect(
      await findings({ file: ".eslintrc.json", config: '{"rules":{"no-debugger":"warn"}}' }),
    ).toHaveLength(0);
  });

  test("skips multiple flat configs", async () => {
    expect(await findings({ extra: { "eslint.config.mjs": "export default [];" } })).toHaveLength(
      0,
    );
  });

  test("requires root working directory", async () => {
    expect(await findings({ directory: "app" })).toHaveLength(0);
  });

  test("default file ignores do not disable warning rules", async () => {
    expect(
      await findings({
        config:
          'export default [{ignores: ["**/node_modules/", ".git/"]}, {rules: {"no-debugger": "warn"}}];',
      }),
    ).toHaveLength(1);
  });

  test("default file ignores alone do not prove warning rules", async () => {
    expect(
      await findings({ config: 'export default [{ignores: ["**/node_modules/", ".git/"]}];' }),
    ).toHaveLength(0);
  });

  test("honors inherited legacy config environment", async () => {
    expect(
      await findings({
        version: "^9.0.0",
        extra: {
          ".github/workflows/ci.yml":
            'name: CI\non: push\nenv:\n  ESLINT_USE_FLAT_CONFIG: "false"\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: eslint src\n',
        },
      }),
    ).toHaveLength(0);
  });

  test("uses locked ESLint version rather than latest declaration", async () => {
    expect(
      await findings({
        version: "latest",
        extra: {
          "package-lock.json": JSON.stringify({
            name: "test",
            lockfileVersion: 3,
            packages: {
              "": { devDependencies: { eslint: "latest" } },
              "node_modules/eslint": { version: "10.0.0" },
            },
          }),
        },
      }),
    ).toHaveLength(1);
  });

  test("does not follow recursive scripts", async () => {
    expect(await findings({ lint: "bun run check" })).toHaveLength(0);
  });

  test("is not reported in strict mode", async () => {
    const cwd = await fixture();
    const report = await analyzeRepository({ cwd, targetPath: ".", topCount: 100 });
    expect(report.findings.some((finding) => finding.ruleId === rule.id)).toBe(false);
  });

  const legacyConfig = {
    file: ".eslintrc.json",
    config: '{"root":true,"env":{"node":true},"rules":{"no-debugger":"warn"}}',
  };

  test.each(["^7.0.0", "^8.57.0"])("detects legacy warning analysis on %s", async (version) => {
    const result = await findings({ ...legacyConfig, version });
    expect(result).toHaveLength(1);
    expect(result[0]?.suggestion).toContain("CI-specific config");
    expect(result[0]?.suggestion).toContain("Adding --quiet is not a performance fix");
  });

  test.each(["^7.0.0", "^8.57.0"])("quiet still executes warnings on %s", async (version) => {
    const result = await findings({ ...legacyConfig, version, lint: "eslint --quiet src" });
    expect(result).toHaveLength(1);
    expect(result[0]?.why).toContain("only hides warnings");
    expect(result[0]?.aiHandoff).toContain("do not suggest --quiet alone");
  });

  test.each([
    "--max-warnings=0",
    "--quiet --max-warnings 5",
    "--fix",
    "--quiet -f json",
    "--no-eslintrc",
  ])("preserves intentional legacy warnings %s", async (flag) => {
    expect(
      await findings({ ...legacyConfig, version: "^8.57.0", lint: `eslint ${flag} src` }),
    ).toHaveLength(0);
  });

  test.each([".eslintrc", ".eslintrc.json"])("supports legacy JSON %s", async (file) => {
    expect(
      await findings({ ...legacyConfig, file, version: "^8.57.0", lint: "eslint --quiet src" }),
    ).toHaveLength(1);
  });

  test.each([".eslintrc.js", ".eslintrc.cjs"])(
    "supports literal legacy CommonJS %s",
    async (file) => {
      expect(
        await findings({
          file,
          version: "^8.57.0",
          lint: "eslint --quiet src",
          config: 'module.exports = {root: true, rules: {"no-debugger": [1, {}]}};',
        }),
      ).toHaveLength(1);
    },
  );

  test("supports legacy package.json eslintConfig", async () => {
    expect(
      await findings({
        file: "README.md",
        config: "# Test",
        version: "^8.57.0",
        run: "eslint --quiet src",
        extra: {
          "package.json": JSON.stringify({
            devDependencies: { eslint: "^8.57.0" },
            eslintConfig: { rules: { "no-debugger": 1 } },
          }),
        },
      }),
    ).toHaveLength(1);
  });

  test.each([
    '{"rules":{"no-debugger":"error"}}',
    '{"extends":"eslint:recommended","rules":{"no-debugger":"warn"}}',
    '{"overrides":[],"rules":{"no-debugger":"warn"}}',
    "{ broken",
  ])("skips uncertain or non-warning legacy JSON %s", async (config) => {
    expect(
      await findings({ ...legacyConfig, version: "^8.57.0", lint: "eslint --quiet src", config }),
    ).toHaveLength(0);
  });

  test("never executes legacy config", async () => {
    expect(
      await findings({
        version: "^8.57.0",
        file: ".eslintrc.cjs",
        config:
          'throw new Error("must not execute"); module.exports = {rules: {"no-debugger": "warn"}};',
      }),
    ).toHaveLength(0);
  });

  test("does not guess legacy config precedence", async () => {
    expect(
      await findings({
        ...legacyConfig,
        version: "^8.57.0",
        extra: { ".eslintrc.cjs": 'module.exports = {rules: {"no-debugger": "error"}};' },
      }),
    ).toHaveLength(0);
  });

  test("uses locked old version for quiet behavior", async () => {
    const result = await findings({
      ...legacyConfig,
      version: "latest",
      lint: "eslint --quiet src",
      extra: {
        "package-lock.json": JSON.stringify({
          name: "test",
          lockfileVersion: 3,
          packages: {
            "": { devDependencies: { eslint: "latest" } },
            "node_modules/eslint": { version: "8.57.0" },
          },
        }),
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain("ESLint 8");
  });
});
