import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { fixtures } from "./fixtures.ts";
import {
  createTempDirTracker,
  memoizedAnalyzeRepository,
  writeRepositoryFiles,
} from "./helpers.ts";

const ruleId = "buildkite-docker-compose-run-without-prebuild";
const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function fixtureFindings(fixture: string, mode: "strict" | "exploratory" = "strict") {
  const report = await memoizedAnalyzeRepository({
    cwd: fixture,
    targetPath: ".",
    topCount: 100,
    mode,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe("buildkite-docker-compose-run-without-prebuild", () => {
  test("reports one finding for three group-nested run steps", async () => {
    const found = await fixtureFindings(fixtures.buildkiteDockerComposeRunLike);
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.confidence).toBe("medium");
    expect(found[0]?.message).toContain("3 step executions");
    expect(found[0]?.message).toContain(":golang: vet, :golang: test, :golang: build");
    expect(found[0]?.suggestion).toContain("build: app");
    expect(found[0]?.suggestion).toContain("push: app:");
    expect(found[0]?.measurementHint).toContain("docker-compose build time");
  });

  test("counts parallelism as step executions", async () => {
    const found = await fixtureFindings(fixtures.buildkiteDockerComposeParallelismLike);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("20 step executions");
  });

  test("resolves the compose file from the plugin config option", async () => {
    const found = await fixtureFindings(fixtures.buildkiteDockerComposeConfigLike);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("3 step executions");
  });

  test("counts steps that build locally without pushing", async () => {
    const found = await fixtureFindings(fixtures.buildkiteDockerComposeBuildNoPushLike);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("2 step executions");
  });

  test.each([
    ["prebuild step with build and push", fixtures.buildkiteDockerComposePrebuildOk],
    ["image-only service", fixtures.buildkiteDockerComposeImageOnlyOk],
    ["missing compose file", fixtures.buildkiteDockerComposeMissingComposeOk],
    ["single run step", fixtures.buildkiteDockerComposeSingleRunOk],
    ["run-image on one run step", fixtures.buildkiteDockerComposeRunImageOk],
  ])("does not report when %s", async (_name, fixture) => {
    expect(await fixtureFindings(fixture)).toHaveLength(0);
  });

  test("counts matrix combinations and resolves COMPOSE_FILE from step env", async () => {
    const root = await tempDirs.create("bk-compose-matrix-");
    await writeRepositoryFiles(root, {
      [path.join(".buildkite", "pipeline.yml")]: [
        "steps:",
        "  - label: test app",
        "    command: go test ./...",
        "    env:",
        "      COMPOSE_FILE: docker-compose.ci.yml",
        "    plugins:",
        "      - docker-compose#v5.12.1:",
        "          run: app",
        "    matrix:",
        "      setup:",
        "        os: [linux, darwin]",
        "        arch: [amd64, arm64]",
        "  - label: vet app",
        "    command: go vet ./...",
        "    plugins:",
        "      - docker-compose#v5.12.1:",
        "          run: app",
      ].join("\n"),
      "docker-compose.ci.yml": "services:\n  app:\n    build: .\n",
    });
    const found = await fixtureFindings(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("5 step executions");
  });
});
