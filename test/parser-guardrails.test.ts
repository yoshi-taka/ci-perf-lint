import { describe, expect, test } from "bun:test";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import { parseGitlabCi } from "../src/gitlab-ci-workflow.ts";
import { parseWorkflow } from "../src/workflow.ts";

describe("parser guardrails", () => {
  test("rejects oversized workflow source", () => {
    expect(() =>
      parseWorkflow("/repo/.github/workflows/ci.yml", "/repo", "a".repeat(5_000_001)),
    ).toThrow("Workflow source too large");
  });

  test("rejects oversized platform sources", () => {
    expect(() =>
      parsePipeline("/repo/.buildkite/pipeline.yml", "/repo", "a".repeat(5_000_001)),
    ).toThrow("Pipeline source too large");
    expect(() => parseGitlabCi("/repo/.gitlab-ci.yml", "/repo", "a".repeat(5_000_001))).toThrow(
      "GitLab CI source too large",
    );
    expect(() =>
      parseCircleCi("/repo/.circleci/config.yml", "/repo", "a".repeat(5_000_001)),
    ).toThrow("CircleCI source too large");
  });
});
