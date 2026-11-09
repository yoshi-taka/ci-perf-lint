import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

test.each([
  ["docker build --no-cache .", true],
  ["echo docker build --no-cache .", false],
  ["printf '%s\\n' 'docker build --no-cache .'", false],
  ["# docker build --no-cache .\necho done", false],
  ["docker build .\necho --no-cache", false],
  ['echo "$(docker build --no-cache .)"', true],
] as const)("all CI formats share command evidence: %s", async (command, expected) => {
  const cwd = await tempDirs.create("apl-shell-output-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      on: "push",
      jobs: { build: { "runs-on": "ubuntu-latest", steps: [{ run: command }] } },
    }),
    ".buildkite/pipeline.yml": stringify({ steps: [{ label: "build", command }] }),
    ".gitlab-ci.yml": stringify({ build: { script: [command] } }),
    ".circleci/config.yml": stringify({
      version: 2.1,
      jobs: { build: { docker: [{ image: "cimg/base:stable" }], steps: [{ run: command }] } },
    }),
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(report.workflowCount).toBe(4);
  expect(
    report.findings.filter((finding) => finding.ruleId === "docker-build-cache-disabled-in-ci"),
  ).toHaveLength(expected ? 4 : 0);
});

test("printed bake commands cannot suppress advice for actual repeated builds", async () => {
  const cwd = await tempDirs.create("apl-shell-output-bake-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      on: "push",
      jobs: {
        build: {
          "runs-on": "ubuntu-latest",
          steps: [
            { run: "docker build -t first ." },
            { run: "docker build -t second ." },
            { run: "echo 'docker buildx bake'" },
          ],
        },
      },
    }),
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(
    report.findings.some((finding) => finding.ruleId === "prefer-buildx-bake-for-multiple-images"),
  ).toBe(true);
});
