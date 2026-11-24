import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";
import { parseGitlabCi } from "../src/gitlab-ci-workflow.ts";

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

describe("analyzeRepository GitLab CI rules", () => {
  test("finds missing timeout in GitLab CI jobs", async () => {
    const report = await getFixtureReport(fixtures.gitlabCiTimeoutLike, {
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(report.workflowCount).toBe(1);
    expect(ruleIds).toContain("missing-timeout-in-minutes-gitlab-ci");

    const timeoutFinding = report.findings.find(
      (finding) => finding.ruleId === "missing-timeout-in-minutes-gitlab-ci",
    );
    expect(timeoutFinding).toBeDefined();
    expect(timeoutFinding?.severity).toBe("warning");
    expect(timeoutFinding?.message).toContain("timeout");
  });

  test("applies scope:both rules to GitLab CI", async () => {
    const report = await getFixtureReport(fixtures.scopeBothGitlabLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).toContain("prefer-buildx-build-over-docker-build");
    expect(ruleIds).toContain("wasteful-npm-global-install");
  });

  test("does not flag timeouts when all heavy jobs have timeout", async () => {
    const report = await getFixtureReport(fixtures.gitlabCiTimeoutOk, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(report.workflowCount).toBe(1);
    expect(ruleIds).not.toContain("missing-timeout-in-minutes-gitlab-ci");
  });
});

test("does not flag hidden GitLab CI templates", async () => {
  const root = await tempDirs.create("apl-gitlab-hidden-template-");
  await mkdir(path.join(root), { recursive: true });
  await writeFile(
    path.join(root, ".gitlab-ci.yml"),
    [
      ".test-default:",
      "  script:",
      "    - go test -race ./...",
      "tests:",
      "  script:",
      "    - go test -race ./...",
    ].join("\n"),
  );
  const report = await getFixtureReport(root, {
    targetPath: ".",
    topCount: 10,
    mode: "exploratory",
  });
  const findings = report.findings.filter(
    (finding) => finding.ruleId === "missing-timeout-in-minutes-gitlab-ci",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('Job "tests"');
});

test("reads map-form image name for Node version detection", async () => {
  const root = await tempDirs.create("apl-gitlab-image-map-");
  await mkdir(path.join(root), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { build: "echo built" } }),
  );
  await writeFile(
    path.join(root, ".gitlab-ci.yml"),
    [
      "build:",
      "  image:",
      "    name: node:24",
      '    entrypoint: ["/bin/bash"]',
      "  script: npm run build",
    ].join("\n"),
  );
  const report = await getFixtureReport(root, {
    targetPath: ".",
    topCount: 10,
    mode: "exploratory",
  });
  const findings = report.findings.filter(
    (finding) => finding.ruleId === "prefer-node-run-over-npm-run",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('Job "build"');
});

test("reads documented bool and int scalars on GitLab CI jobs", () => {
  const doc = parseGitlabCi(
    "/repo/.gitlab-ci.yml",
    "/repo",
    [
      "build:",
      "  script: echo hi",
      "  interruptible: true",
      "  allow_failure: true",
      "  parallel: 3",
      "deploy:",
      "  script: echo hi",
      "  interruptible: false",
      "  allow_failure: false",
    ].join("\n"),
  );
  expect(doc.jobs[0]?.interruptible).toBe(true);
  expect(doc.jobs[0]?.allowFailure).toBe(true);
  expect(doc.jobs[0]?.parallel).toBe(3);
  expect(doc.jobs[1]?.interruptible).toBe(false);
  expect(doc.jobs[1]?.allowFailure).toBe(false);
});
