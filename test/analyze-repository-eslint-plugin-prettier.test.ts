import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "avoid-eslint-plugin-prettier", severity: "warning" } as const;

async function findings(
  config: string,
  devDependencies: Record<string, string> = {},
): Promise<Awaited<ReturnType<typeof analyzeRepositoryForRule>>["findings"]> {
  const cwd = await tempDirs.create("ci-perf-eslint-prettier-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({
      private: true,
      devDependencies: { eslint: "^9.0.0", ...devDependencies },
      scripts: { lint: "eslint src", check: "bun run lint" },
    }),
    "eslint.config.js": config,
    "src/index.js": "export const value = 1;\n",
    ".github/workflows/ci.yml": `name: CI
on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: bun run lint
`,
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", topCount: 100, mode: "exploratory" },
    rule,
  );
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("avoid-eslint-plugin-prettier repository evidence", () => {
  test.each([
    [
      "URL in a comment",
      '// https://github.com/prettier/eslint-plugin-prettier#readme\nexport default [{ rules: { "no-debugger": "error" } }];',
    ],
    [
      "commented-out rule",
      'export default [{ rules: { // "prettier/prettier": "error",\n "no-debugger": "error" } }];',
    ],
    [
      "block comment",
      '/* plugins: ["prettier"]; rules: { "prettier/prettier": "error" } */\nexport default [{ rules: { "no-debugger": "error" } }];',
    ],
    [
      "eslint-config-prettier in extends",
      'export default [{ extends: ["prettier"], rules: { "no-debugger": "error" } }];',
    ],
  ])("does not flag %s", async (_name, config) => {
    expect(await findings(config)).toHaveLength(0);
  });

  test("flags a real plugins entry", async () => {
    const result = await findings(
      'export default [{ plugins: ["prettier"], rules: { "no-debugger": "error" } }];',
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.location.path).toMatch(/eslint\.config/);
  });

  test("flags a flat-config prettier plugin object", async () => {
    const result = await findings(
      'import prettier from "eslint-plugin-prettier";\nexport default [{ plugins: { prettier } }];',
    );
    expect(result).toHaveLength(1);
  });

  test("flags plugin:prettier/recommended without comments", async () => {
    expect(
      await findings('export default [{ extends: ["plugin:prettier/recommended"] }];'),
    ).toHaveLength(1);
  });

  test("flags eslint-plugin-prettier in package metadata", async () => {
    expect(
      await findings('export default [{ rules: { "no-debugger": "error" } }];', {
        "eslint-plugin-prettier": "^5.0.0",
      }),
    ).toHaveLength(1);
  });

  test("points evidence at the live rule, not a commented one", async () => {
    const result = await findings(
      '// "prettier/prettier": "error",\nexport default [{ rules: { "prettier/prettier": "error" } }];',
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.location.line).toBe(2);
  });
});
