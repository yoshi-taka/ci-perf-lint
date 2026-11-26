import { describe, expect, test } from "bun:test";
import {
  blankOutCodeComments,
  codeDisablesPrettierRule,
  codeMentionsEnabledPrettierRule,
  codeMentionsPrettierPlugin,
  codeMentionsPrettierRecommendedConfig,
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
    expect(codeMentionsEnabledPrettierRule(text)).toBe(false);
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

  test.each(['"error"', '"warn"', "2", "1", '["error", { semi: false }]'])(
    "recognizes enabled rule severity %s",
    (severity) => {
      expect(codeMentionsEnabledPrettierRule(`rules: { "prettier/prettier": ${severity} }`)).toBe(
        true,
      );
    },
  );

  test("recognizes multiline rule settings", () => {
    expect(
      codeMentionsEnabledPrettierRule(
        'rules: { "prettier/prettier": [\n  "error",\n  { singleQuote: true }\n] }',
      ),
    ).toBe(true);
    expect(codeDisablesPrettierRule('rules: { "prettier/prettier": [\n  "off"\n] }')).toBe(true);
  });

  test.each(['"off"', "0", '["off"]', "[0]"])("ignores disabled rule severity %s", (severity) => {
    const text = `rules: { "prettier/prettier": ${severity} }`;
    expect(codeMentionsEnabledPrettierRule(text)).toBe(false);
    expect(codeDisablesPrettierRule(text)).toBe(true);
  });

  test("recognizes plugin:prettier/recommended in code", () => {
    expect(codeMentionsPrettierRecommendedConfig('extends: ["plugin:prettier/recommended"]')).toBe(
      true,
    );
  });
});
