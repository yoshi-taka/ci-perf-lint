import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const ruleId = "circleci-checkout-with-full-workspace";

async function findingsFor(fixture: keyof typeof fixtures) {
  const report = await analyzeRepository({
    cwd: fixtures[fixture],
    targetPath: ".",
    workflowOnly: true,
    mode: "strict",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test("reports checkout after a full-project workspace attach", async () => {
  const findings = await findingsFor("circleciFullWorkspaceRootLike");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('Job "publish"');
  expect(findings[0]?.message).toContain('from job "build_and_test"');
  expect(findings[0]?.location.path).toBe(".circleci/config.yml");
  expect(findings[0]?.location.line).not.toBe(1);
});

test("resolves checkout.path and working_directory for the workspace root", async () => {
  const findings = await findingsFor("circleciFullWorkspaceCheckoutPathLike");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('Job "py3"');
  expect(findings[0]?.message).toContain('from job "build"');
});

test("does not report a workspace that contains only a subdirectory", async () => {
  const findings = await findingsFor("circleciFullWorkspaceSubdirOk");
  expect(findings).toHaveLength(0);
});

test("does not report when the downstream job pushes git changes", async () => {
  const findings = await findingsFor("circleciFullWorkspaceGitPushOk");
  expect(findings).toHaveLength(0);
});

test("does not report when the attach job is not reachable through requires", async () => {
  const findings = await findingsFor("circleciFullWorkspaceUnreachableOk");
  expect(findings).toHaveLength(0);
});
