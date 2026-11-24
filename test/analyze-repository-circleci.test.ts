import { afterEach, describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";
import { parseCircleCi } from "../src/circleci-workflow.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

test("reads documented bool and int scalars on CircleCI jobs and steps", () => {
  const doc = parseCircleCi(
    "/repo/.circleci/config.yml",
    "/repo",
    [
      "version: 2.1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/node:22.1}]",
      "    parallelism: 4",
      "    steps:",
      "      - run:",
      "          command: echo hi",
      "          background: true",
      "      - run:",
      "          command: echo bye",
      "          background: false",
      "      - setup_remote_docker:",
      "          docker_layer_caching: true",
    ].join("\n"),
  );
  expect(doc.jobs[0]?.parallelism).toBe(4);
  const steps = doc.jobs[0]?.steps ?? [];
  expect(steps[0]?.background).toBe(true);
  expect(steps[1]?.background).toBe(false);
  expect(steps[2]?.dockerLayerCaching).toBe(true);
});

describe("analyzeRepository CircleCI rules", () => {
  test("parses .circleci/config.yml and discovers jobs", async () => {
    const report = await getFixtureReport(fixtures.circleciFullCloneLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.workflowCount).toBe(1);
    expect(report.workflows[0]?.path).toContain(".circleci/config.yml");
  });

  test("finds checkout method: full without git history need", async () => {
    const report = await getFixtureReport(fixtures.circleciFullCloneLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.length).toBeGreaterThan(0);
    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("circleci-checkout-uses-full-clone");
  });

  test("does not flag blobless checkout", async () => {
    const report = await getFixtureReport(fixtures.circleciFullCloneOk, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(ruleIds).not.toContain("circleci-checkout-uses-full-clone");
  });

  test("applies scope:both rules to CircleCI", async () => {
    const report = await getFixtureReport(fixtures.scopeBothCircleciLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).toContain("prefer-buildx-build-over-docker-build");
    expect(ruleIds).toContain("wasteful-npm-global-install");
  });

  test("does not flag full checkout when git history is needed", async () => {
    const report = await getFixtureReport(fixtures.circleciFullCloneOkUsesHistory, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(ruleIds).not.toContain("circleci-checkout-uses-full-clone");
  });
});
