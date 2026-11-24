import { describe, expect, test } from "bun:test";
import { collectPersistentCacheDockerTargets } from "../src/repository-diagnostics/docker-persistent-cache-targets.ts";
import { parsePipeline } from "../src/buildkite-workflow.ts";

const REPO = "/repo";

function targets(yaml: string) {
  const doc = parsePipeline(`${REPO}/.buildkite/pipeline.yml`, REPO, yaml);
  return collectPersistentCacheDockerTargets(REPO, [doc]);
}

describe("Buildkite docker-state classification and plugins", () => {
  test("steps without plugins keep local docker-state persistence", () => {
    const result = targets(
      [
        "steps:",
        "  - label: build",
        "    command: docker build --builder default -t img .",
        "    cache: /var/lib/docker",
      ].join("\n"),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.cacheMountPersistence).toBe("buildkite-docker-state");
  });

  test("docker-managing plugins exclude the step from local docker state", () => {
    const result = targets(
      [
        "steps:",
        "  - label: build",
        "    command: docker build --builder default -t img .",
        "    cache: /var/lib/docker",
        "    plugins:",
        "      - docker#v5.13.0: {}",
      ].join("\n"),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.cacheMountPersistence).toBeUndefined();
  });

  test("annotator plugins must not exclude the step from local docker state", () => {
    const result = targets(
      [
        "steps:",
        "  - label: build",
        "    command: docker build --builder default -t img .",
        "    cache: /var/lib/docker",
        "    plugins:",
        "      - test-summary#v1.0: {}",
      ].join("\n"),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.cacheMountPersistence).toBe("buildkite-docker-state");
  });
});
