import { expect, test } from "bun:test";
import { collectStorybookCommands } from "../src/rules/shared/storybook-commands.ts";

test.each([
  ["storybook build", [false]],
  ["npx build-storybook", [false]],
  ["npx --yes storybook build --test", [true]],
  ["pnpm exec storybook build", [false]],
  ["yarn exec storybook build --test", [true]],
  ["storybook build && storybook build --test", [false, true]],
  ["storybook build --test && storybook build", [true, false]],
  ["storybook build && echo --test", [false]],
  ['storybook build --output-dir "directory --test"', [false]],
  ["storybook build --output-dir --test", [false]],
  ["storybook build -- --test", [false]],
  ["storybook build # --test", [false]],
  ["storybook build --docs --test", [true]],
  ["storybook build --stats-json --test", [true]],
  ['storybook build --stats-json "directory --test"', [false]],
  ["storybook build --test=false", []],
  ["storybook build --help", []],
  ["echo 'storybook build'", []],
  ["npm run build-storybook", []],
  ["npm run build-storybook && storybook build", [false]],
  ["cat <<EOF\nstorybook build\nEOF", []],
  ["storybook build $OPTIONS", []],
  ["SB_TESTBUILD=true npx storybook build", [true]],
  ["SB_TESTBUILD=true storybook build && storybook build", [true, false]],
  ["export SB_TESTBUILD=true\nstorybook build", [true]],
  ["SB_TESTBUILD=true\nstorybook build", [false]],
  ["SB_TESTBUILD=true\nexport SB_TESTBUILD\nstorybook build", [true]],
  ["export SB_TESTBUILD=true\nSB_TESTBUILD=false\nstorybook build", [false]],
  ["env SB_TESTBUILD=true\nstorybook build", [false]],
  ["export SB_TESTBUILD=true\nunset SB_TESTBUILD\nstorybook build", [false]],
  ["echo SB_TESTBUILD=true && storybook build", [false]],
  ["export SB_TESTBUILD=$MODE\nstorybook build", []],
  ["if test -f ready; then storybook build; fi", []],
] as const)("build mode belongs to its invocation: %s", (text, expected) => {
  expect(collectStorybookCommands(text).builds).toEqual([...expected]);
});

test.each([
  ["true", [true]],
  [true, [true]],
  ["false", [false]],
  [false, [false]],
  ["TRUE", [false]],
  ["1", [false]],
  ["yes", [false]],
  ["", [false]],
  ["$MODE", []],
] as const)("SB_TESTBUILD must match true exactly: %s", (value, expected) => {
  expect(collectStorybookCommands("storybook build", { SB_TESTBUILD: value }).builds).toEqual([
    ...expected,
  ]);
});

test.each([
  ["test-storybook", true],
  ["npx test-storybook", true],
  ["storybook test", true],
  ["npx chromatic", true],
  ["npx @storybook/test-runner", true],
  ["echo 'test-storybook'", false],
  ["npm install @storybook/test-runner", false],
  ["echo chromatic", false],
  ["storybook build --output-dir test-storybook", false],
  ["test-storybook --help", false],
  ["cat <<EOF\ntest-storybook\nEOF", false],
] as const)("consumers must be executed: %s", (text, expected) => {
  expect(collectStorybookCommands(text).testConsumer).toBe(expected);
});

test("inline ENV overrides inherited mode without changing the following invocation", () => {
  expect(
    collectStorybookCommands("SB_TESTBUILD=false storybook build && storybook build", {
      SB_TESTBUILD: "true",
    }).builds,
  ).toEqual([false, true]);
  expect(
    collectStorybookCommands("SB_TESTBUILD=false\nstorybook build", { SB_TESTBUILD: "true" })
      .builds,
  ).toEqual([false]);
});
