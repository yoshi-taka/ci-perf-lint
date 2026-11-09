import { expect, test } from "bun:test";
import {
  textHasHistoryDependentExecution,
  textHasOpaqueRepositoryExecution,
  textHasShellFileRedirection,
} from "../src/rules/shared/repository-command-evidence.ts";

test.each([
  ["git log --oneline", true],
  ["sudo -n git -C repo log", true],
  ["git --git-dir=.git rev-list HEAD", true],
  ["npx semantic-release", true],
  ["pnpm --filter app exec commitlint", true],
  ["pnpm --filter exec exec git log", true],
  ["echo 'git log'", false],
  ["printf '%s' 'scripts/version.sh'", false],
  ["grep 'git log' file.txt", false],
  ["# git log\necho done", false],
  ["gh api -f message='git log' repos/a/b/issues", false],
  ["git -c label='git log' status", false],
  ["npm run changelog", true],
  ['echo "$(git log)"', true],
  ["echo '$(git log)'", false],
] as const)("history evidence belongs to command position: %s", (run, expected) => {
  expect(textHasHistoryDependentExecution(run)).toBe(expected);
});

test.each([
  ["./scripts/version.sh", true],
  ["bash scripts/version.sh", true],
  ["node tools/build.mjs", true],
  ["python -m build", true],
  ["pip install -e .", true],
  ["uv run test", true],
  ["pnpm --filter app exec bash scripts/test.sh", true],
  ["npx node ./scripts/test.js", true],
  ['eval "$COMMAND"', true],
  ["$COMMAND", true],
  ["git -c alias.x='!./helper' x", true],
  ["env -i bash -c work", true],
  ["cat <<EOF\nwork\nEOF", true],
  ["echo $((1 + 2))", true],
  ["echo 'unterminated", true],
  ['echo "$(echo $((1 + 2)))"', true],
  ["echo './scripts/version.sh'", false],
  ["printf '%s' 'python -m build'", false],
  ["# bash scripts/version.sh\necho done", false],
  ["grep scripts/version.sh results.log", false],
  ["echo '$(./scripts/version.sh)'", false],
  ['echo "$(./scripts/version.sh)"', true],
  ["node --version", false],
  ["bash --version", false],
] as const)("opaque work is conservative without treating logs as scripts: %s", (run, expected) => {
  expect(textHasOpaqueRepositoryExecution(run)).toBe(expected);
});

test.each([
  ["echo done > report.md", true],
  ["printf '%s' done >> .git/config", true],
  ["echo 'cat < package.json'", false],
  ["echo 'done > report.md'", false],
  ["# echo done > report.md\necho done", false],
  ["diff <(tar tzf before.tgz) <(tar tzf after.tgz)", false],
  ['echo "X=value" >> "$GITHUB_ENV"', false],
  ["echo 'X=value' >> '$GITHUB_ENV'", true],
  ['echo "$(cat < package.json)"', true],
] as const)("file redirection is not displayed punctuation: %s", (run, expected) => {
  expect(textHasShellFileRedirection(run)).toBe(expected);
});
