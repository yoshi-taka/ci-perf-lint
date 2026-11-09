import { expect, test } from "bun:test";
import { toolingWorkNames } from "../src/rules/shared/tooling-command-evidence.ts";
import { shellInvocations } from "../src/rules/shared/shell-invocations.ts";

test.each([
  ["echo 'npm test'", ["echo"]],
  ["printf '%s' 'pytest'", ["printf"]],
  ["# ruff check .", []],
  ["npx prettier --check tests/build.ts", ["prettier"]],
  ["ruff check tests/build.py", ["ruff"]],
  ["npm run test:unit", ["test:unit"]],
  ["poetry run pytest", ["pytest"]],
  ["python -m build", ["build"]],
] as const)("work names exclude data arguments: %s", (text, expected) => {
  expect(toolingWorkNames(text)).toEqual([...expected]);
});

test("npm exec unwraps only supported invocation syntax", () => {
  expect(shellInvocations("npm exec --yes -- oxlint .")).toEqual([["oxlint", "."]]);
  expect(shellInvocations("npm exec --package unknown oxlint .")).toEqual([]);
  expect(shellInvocations("echo 'npm exec -- oxlint .'")[0]?.[0]).toBe("echo");
});
