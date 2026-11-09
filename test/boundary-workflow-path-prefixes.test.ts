import { expect, test } from "bun:test";
import type { WorkflowJob, WorkflowStep } from "../src/workflow.ts";
import { collectScopePrefixes } from "../src/rules/shared/workflow-path-prefixes.ts";
import { shellFileRedirectionTargets } from "../src/rules/shared/repository-command-evidence.ts";

const prefixes = (steps: Partial<WorkflowStep>[]) => collectScopePrefixes({ steps } as WorkflowJob);

test.each([
  ["echo 'packages/fake'", []],
  ["gh api -f message=packages/fake repos/a/b/issues", []],
  ["cat packages/real/file.txt", ["packages/real"]],
  ["cat --label packages/fake unrelated.txt", []],
  ["cp -S packages/fake source.txt dest.txt", []],
  ["cp -a packages/real/src packages/real/dest", ["packages/real"]],
  ["test -n packages/fake", []],
  ["test -f packages/real/file.txt", ["packages/real"]],
  ["echo 'packages/fake' > 'packages/real/version.txt'", ["packages/real"]],
  ["echo 'version > packages/fake/version.txt'", []],
  ["echo x >packages/one/file>packages/two/file", ["packages/one", "packages/two"]],
  ["echo x >${UNKNOWN}/packages/fake/file", []],
] as const)("scope is based on owned path words: %s", (run, expected) => {
  expect(prefixes([{ run }])).toEqual([...expected]);
});

test("static redirection target extraction retains quoting and ignores displayed arrows", () => {
  expect(
    shellFileRedirectionTargets(
      "echo 'x > fake' >> 'packages/real/file.txt' && cat <packages/input/file.txt",
    ),
  ).toEqual(["'packages/real/file.txt'", "packages/input/file.txt"]);
  expect(shellFileRedirectionTargets("diff <(cat first.txt) <(cat second.txt)")).toEqual([]);
});
