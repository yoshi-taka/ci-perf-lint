import { expect, test } from "bun:test";
import { textRunsTool } from "../src/rules/shared/tool-command-evidence.ts";
import { textRunsEslintWithoutConcurrency } from "../src/rules/shared/eslint-concurrency.ts";
import { textRunsTscTypeCheck } from "../src/rules/shared/oxlint-type-check.ts";
import { dependencyInstallCommands } from "../src/rules/shared/dependency-install-evidence.ts";
import { declaredShellEnvironmentValues } from "../src/rules/shared/shell-environment-evidence.ts";

test.each([
  ["npx next build", true],
  ["npx --package next next build", true],
  ["pnpm --filter app exec next build", true],
  ['echo "$(next build)"', true],
  ["echo 'next build'", false],
  ["# next build\necho done", false],
  ["gh api -f message='next build' endpoint", false],
  ["next build --help", false],
] as const)("tool workload is not display or argument data: %s", (text, expected) => {
  expect(textRunsTool(text, "next", ["build"])).toBe(expected);
});

test("same-named argument data cannot overwrite a leading environment assignment", () => {
  expect(declaredShellEnvironmentValues('MYPY_NUM_WORKERS=8 mypy "MYPY_NUM_WORKERS=0"')).toEqual({
    MYPY_NUM_WORKERS: "8",
  });
  expect(declaredShellEnvironmentValues('echo "UV_TORCH_BACKEND=cpu"')).toEqual({});
  expect(declaredShellEnvironmentValues('echo "UV_TORCH_BACKEND=cpu" >> "$GITHUB_ENV"')).toEqual({
    UV_TORCH_BACKEND: "cpu",
  });
});

test.each([
  ["npx eslint .", true],
  ["npx --package eslint eslint .", true],
  ["echo 'eslint .'", false],
  ["# eslint .\necho done", false],
  ["eslint . --concurrency auto", false],
  ["eslint . && echo --concurrency=auto", true],
  ["eslint . --rule '--concurrency=auto'", true],
  ["eslint . --ignore-pattern '--help'", true],
  ["eslint . -- --concurrency=auto", true],
  ["eslint --print-config file.js", false],
  ['echo "$(eslint .)"', true],
] as const)("ESLint tuning belongs to the executed ESLint command: %s", (text, expected) => {
  expect(textRunsEslintWithoutConcurrency(text)).toBe(expected);
});

test.each([
  ["tsc --noEmit", true],
  ["npx tsc --noEmit true", true],
  ["tsc --noEmit false", false],
  ["tsc --noEmit=false", false],
  ["tsc --noEmit --noEmit false", false],
  ["tsc --noEmit false --noEmit", true],
  ["echo 'tsc --noEmit'", false],
  ["# tsc --noEmit\necho done", false],
  ["tsc --project '--noEmit'", false],
  ["tsc -- --noEmit", false],
  ["tsc --noEmit --help", false],
  ["tsc && echo --noEmit", false],
  ['echo "$(tsc --noEmit)"', true],
] as const)("tsc replacement requires its own explicit noEmit: %s", (text, expected) => {
  expect(textRunsTscTypeCheck(text)).toBe(expected);
});

test.each([
  ["pip install torch", ["torch"]],
  ["python -m pip install torch==2.5", ["torch==2.5"]],
  ["uv pip install torch", ["torch"]],
  ["poetry add torchvision", ["torchvision"]],
  ["echo 'pip install torch'", []],
  ["pip install --log torch other", ["other"]],
  ["pip install --index-url https://torch.invalid other", ["other"]],
  ["pip install -r torch.txt", []],
  ["pip install --dry-run torch", []],
] as const)("installer package operands exclude logs and option values: %s", (text, expected) => {
  expect(dependencyInstallCommands(text).flatMap((command) => command.packages)).toEqual([
    ...expected,
  ]);
});
