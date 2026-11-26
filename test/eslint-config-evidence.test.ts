import { describe, expect, test } from "bun:test";
import {
  blankOutCodeComments,
  codeMentionsPrettierPlugin,
  codeMentionsPrettierRecommendedConfig,
  codeMentionsPrettierRule,
} from "../src/eslint-config-evidence.ts";

describe("eslint config evidence", () => {
  test("blanks comments without changing offsets or line breaks", () => {
    const text = '// "prettier/prettier": "error"\nconst a = "https://x/y";\n';
    const stripped = blankOutCodeComments(text);
    expect(stripped).toHaveLength(text.length);
    expect(stripped.split("\n")).toHaveLength(text.split("\n").length);
    expect(stripped).toContain('"https://x/y"');
    expect(stripped).not.toContain("prettier/prettier");
  });

  test("ignores prettier mentions in comments and URLs", () => {
    const text = [
      "// https://github.com/prettier/eslint-plugin-prettier#readme",
      '// "prettier/prettier": "error",',
      "/* plugins: ['prettier'] */",
      "# extends: plugin:prettier/recommended",
      'export default [{ extends: ["prettier"] }];',
    ].join("\n");
    expect(codeMentionsPrettierPlugin(text)).toBe(false);
    expect(codeMentionsPrettierRule(text)).toBe(false);
    expect(codeMentionsPrettierRecommendedConfig(text)).toBe(false);
  });

  test.each([
    'plugins: ["prettier"]',
    "plugins: ['prettier', 'react']",
    "plugins: { prettier }",
    "plugins: { prettier: prettierPlugin }",
    "plugins:\n  - prettier\n  - react",
  ])("recognizes a real plugin entry: %s", (text) => {
    expect(codeMentionsPrettierPlugin(text)).toBe(true);
  });

  test("recognizes rule and recommended config in code", () => {
    expect(codeMentionsPrettierRule("rules: { 'prettier/prettier': 'error' }")).toBe(true);
    expect(codeMentionsPrettierRecommendedConfig('extends: ["plugin:prettier/recommended"]')).toBe(
      true,
    );
  });
});
