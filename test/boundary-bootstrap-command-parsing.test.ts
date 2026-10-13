import { describe, expect, test } from "bun:test";
import { detectRedundantBootstrapToolFromText } from "../src/rules/shared/tools-text.ts";
import { normalizeRunCommand } from "../src/rules/shared/tools.ts";

describe("bootstrap option and command boundaries", () => {
  test.each([
    ["npx eslint .", "eslint ."],
    ["npx --yes eslint .", "eslint ."],
    ["npx -y eslint .", "eslint ."],
    ["npx --no eslint .", "eslint ."],
    ["npx --no-install eslint .", "eslint ."],
    ["npx --yes=false eslint .", "eslint ."],
    ["npx --no=true eslint .", "eslint ."],
    ["npx --yes --no eslint .", "eslint ."],
    ["npx --package eslint eslint .", "eslint ."],
    ["npx -p eslint eslint .", "eslint ."],
    ["npx --package=eslint eslint .", "eslint ."],
    ["npx --yes --package=eslint -- eslint .", "eslint ."],
    ["npx --package eslint --yes eslint .", "eslint ."],
    ["npx -- eslint .", "eslint ."],
    ['npx --yes "eslint" "src files" --fix', '"eslint" "src files" --fix'],
    ['npx --yes eslint "$FILES"', 'eslint "$FILES"'],
    ["npx --yes eslint . --package=other", "eslint . --package=other"],
    ["npx --yes eslint . && echo done", "eslint . && echo done"],
    ["pnpx eslint .", "eslint ."],
    ["pnpm dlx eslint .", "eslint ."],
    ["bunx eslint .", "eslint ."],
    ["yarn dlx eslint .", "eslint ."],
    ["uvx eslint .", "eslint ."],
    ["uv tool run eslint .", "eslint ."],
  ] as const)("recognizes %s", (command, normalized) => {
    expect(detectRedundantBootstrapToolFromText(command)).toBe("eslint");
    expect(normalizeRunCommand(command)).toBe(normalized);
  });

  test.each([
    "npx",
    "npx --yes",
    "npx --package",
    "npx --package=",
    "npx -p",
    "npx --package --yes eslint .",
    "npx --unknown eslint .",
    'npx -c "eslint ."',
    "npx --package=eslint@9 eslint .",
    "npx eslint@9 .",
    "npx --package=other eslint .",
    "npx -p eslint -p prettier eslint .",
    "npx ./eslint .",
    "npx /usr/bin/eslint .",
    "npx $LINTER .",
    'npx --package="$PACKAGE" eslint .',
    'echo "npx eslint ."',
    "# npx eslint .",
    'npx --yes "eslint',
    "pnpm dlx --unknown eslint .",
  ])("keeps unresolved invocation intact: %s", (command) => {
    expect(detectRedundantBootstrapToolFromText(command)).toBeUndefined();
    expect(normalizeRunCommand(command)).toBe(command);
  });

  test("scaffold tools are excluded from redundant-bootstrap findings", () => {
    expect(detectRedundantBootstrapToolFromText("npx --yes create-vite app")).toBeUndefined();
  });
  test("empty run has an empty normalization", () => {
    expect(normalizeRunCommand(undefined)).toBe("");
  });
});
