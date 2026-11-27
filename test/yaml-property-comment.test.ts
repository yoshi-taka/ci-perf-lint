import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import { collectCircleCiWorkflowInvocations } from "../src/circleci-workflow-graph.ts";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import { fixtures } from "./fixtures.ts";
import { parseWorkflow } from "../src/workflow.ts";

test("CircleCI: anchor with comment applies to the following filters mapping", () => {
  const source = readFileSync(`${fixtures.circleciAnchorCommentOk}/.circleci/config.yml`, "utf8");
  const doc = parseCircleCi(
    "/repo/.circleci/config.yml",
    "/repo",
    source.replace(/^# Source:[^\n]*\n/, ""),
  );
  const invocations = collectCircleCiWorkflowInvocations(doc);
  const production = invocations.find((invocation) => invocation.filters.tags?.only !== undefined);
  expect(production?.filters.branches?.ignore).toEqual(["/.*/"]);
  expect(production?.filters.tags?.only).toEqual(["/^v.*/"]);
});

test("GitHub Actions: anchor with comment applies to the following mapping", () => {
  const doc = parseWorkflow(
    "/repo/.github/workflows/ci.yml",
    "/repo",
    [
      "name: CI",
      "on: push",
      "jobs:",
      "  test:",
      "    strategy: &strategy # shared strategy",
      "      matrix:",
      "        os: [ubuntu-latest]",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo ok",
    ].join("\n"),
  );
  expect(doc.jobs[0]?.raw.strategy).toMatchObject({ matrix: { os: ["ubuntu-latest"] } });
});

test("Buildkite: anchor with comment applies to the following sequence", () => {
  const doc = parsePipeline(
    "/repo/.buildkite/pipeline.yml",
    "/repo",
    [
      "steps:",
      "  - label: test",
      "    plugins: &plugins # shared plugins",
      "      - docker#v5.0.0:",
      "          image: node:22",
      "    commands:",
      "      - echo ok",
    ].join("\n"),
  );
  expect(doc.steps[0]?.plugins).toHaveLength(1);
});
