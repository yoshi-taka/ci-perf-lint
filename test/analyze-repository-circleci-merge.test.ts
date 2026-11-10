import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { assertRuleTestReport, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

test("repeated CircleCI merge keys do not suppress the whole configuration", async () => {
  const report = await analyzeRepository({
    cwd: fixtures.circleciMergeKeysLike,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(report.workflowCount).toBe(1);
  expect(report.analysisWarnings.some((w) => w.kind === "parser-error")).toBe(false);
  assertRuleTestReport(
    report,
    { id: "docker-build-cache-disabled-in-ci", severity: "warning" },
    "exploratory",
  );
  expect(
    report.findings.some(
      (d) =>
        d.ruleId === "docker-build-cache-disabled-in-ci" &&
        d.location.path === ".circleci/config.yml" &&
        d.location.line === 18,
    ),
  ).toBe(true);
});

test("merge-enabled setup configurations still discover continuation files", async () => {
  const cwd = await tempDirs.create("apl-circleci-merge-discovery-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "setup: true",
      "orbs: {resume: circleci/continuation@1.1.0}",
      "defaults: &defaults {context: release}",
      "filters: &filters {filters: {branches: {only: main}}}",
      "jobs:",
      "  setup:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - resume/continue: {configuration_path: .circleci/continued.yml}",
      "workflows:",
      "  setup:",
      "    jobs:",
      "      - setup:",
      "          <<: *defaults",
      "          <<: *filters",
    ].join("\n"),
    ".circleci/continued.yml":
      "version: 2.1\njobs:\n  build:\n    steps:\n      - run: docker build --no-cache .\n",
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(report.workflowCount).toBe(2);
  expect(report.analysisWarnings.some((w) => w.kind === "parser-error")).toBe(false);
  expect(
    report.findings.some(
      (d) =>
        d.ruleId === "docker-build-cache-disabled-in-ci" &&
        d.location.path === ".circleci/continued.yml",
    ),
  ).toBe(true);
});
