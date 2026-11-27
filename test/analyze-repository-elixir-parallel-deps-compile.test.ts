import { afterEach, expect, test } from "bun:test";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const rule = { id: "prefer-elixir-parallel-deps-compile", severity: "warning" } as const;

const circleCiConfig = (compile = "mix deps.compile") =>
  [
    "version: 2.1",
    "orbs:",
    "  elixir: erlef/elixir@1.0",
    "jobs:",
    "  build:",
    "    docker: [{image: cimg/base:stable}]",
    "    steps:",
    "      - checkout",
    `      - run: ${compile}`,
    "workflows:",
    "  ci:",
    "    jobs: [build]",
  ].join("\n");

async function finding(elixirVersion: string, config: string) {
  const cwd = await tempDirs.create("apl-elixir-partition-");
  await writeRepositoryFiles(cwd, {
    ".tool-versions": `erlang 27.0\nelixir ${elixirVersion}\n`,
    "mix.exs": "defmodule Demo.MixProject do\n  use Mix.Project\nend\n",
    ".circleci/config.yml": config,
    ".github/workflows/ci.yml": [
      "name: CI",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: mix deps.compile",
    ].join("\n"),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", topCount: 100, mode: "strict" },
    rule,
  );
  return report.findings.find((candidate) => candidate.ruleId === rule.id);
}

test("CircleCI Elixir orb compile without partition count is flagged", async () => {
  const result = await finding("1.19.0", circleCiConfig());
  expect(result).toBeDefined();
  expect(result?.confidence).toBe("medium");
  expect(result?.location.path).toBe(".tool-versions");
  expect(result?.location.line).toBe(2);
  expect(result?.why).toContain("CircleCI orb may configure it internally");
});

test("an orb compile invocation is evidence without a visible mix command", async () => {
  const result = await finding(
    "1.19.4",
    circleCiConfig().replace(
      "      - run: mix deps.compile",
      "      - elixir/mix_get_and_compile_deps",
    ),
  );
  expect(result).toBeDefined();
  expect(result?.confidence).toBe("medium");
});

test("a visible partition count in CircleCI suppresses the finding", async () => {
  expect(
    await finding(
      "1.19.0",
      [circleCiConfig(), "    environment:", "      MIX_OS_DEPS_COMPILE_PARTITION_COUNT: 4"].join(
        "\n",
      ),
    ),
  ).toBeUndefined();
});

test("Elixir older than 1.19 is not flagged", async () => {
  expect(await finding("1.18.4", circleCiConfig())).toBeUndefined();
});

test("no Elixir orb means no inferred finding", async () => {
  expect(
    await finding("1.19.0", circleCiConfig().replace(/orbs:[\s\S]*?jobs:/, "jobs:")),
  ).toBeUndefined();
});
