import { afterEach, expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { collectWorkflowFiles, resolveWorkflowTarget } from "../src/fs.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(files: Record<string, string>, targetPath = ".") {
  const cwd = await tempDirs.create("apl-gitlab-includes-");
  await writeRepositoryFiles(cwd, files);
  const report = await analyzeRepository({
    cwd,
    targetPath,
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  return { cwd, report };
}

test("follows root-relative local includes recursively and preserves source paths/provider", async () => {
  const { cwd, report } = await scan({
    ".gitlab-ci.yml": "include:\n  - local: /ci/first.yml\n  - local: ci/first.yml\n",
    "ci/first.yml": "include: ci/nested/second.yml\nfirst_test:\n  script: npm test\n",
    "ci/nested/second.yml": "include: /ci/third.yml\nsecond_build:\n  script: docker build .\n",
    "ci/third.yml": "third_test:\n  script: npm test\n  timeout: 10m\n",
    "ci/unreferenced.yml": "unreferenced_test:\n  script: npm test\n",
  });
  expect(report.workflowCount).toBe(4);
  expect(report.workflows.map((w) => w.path)).toEqual([
    ".gitlab-ci.yml",
    "ci/first.yml",
    "ci/nested/second.yml",
    "ci/third.yml",
  ]);
  const timeout = report.findings.filter(
    (f) => f.ruleId === "missing-timeout-in-minutes-gitlab-ci",
  );
  expect(timeout.map((f) => f.location.path).sort()).toEqual([
    "ci/first.yml",
    "ci/nested/second.yml",
  ]);
  expect(
    report.findings.some(
      (f) =>
        f.ruleId === "prefer-buildx-build-over-docker-build" &&
        f.location.path === "ci/nested/second.yml",
    ),
  ).toBe(true);
  expect(await collectWorkflowFiles(await resolveWorkflowTarget(cwd))).toHaveLength(4);
});

test.each(["include: ci/test.yml", "include:\n  local: ci/test.yml", "include:\n  - ci/test.yml"])(
  "accepts local include forms: %s",
  async (include) => {
    const { report } = await scan(
      { ".gitlab-ci.yml": `${include}\n`, "ci/test.yml": "tests:\n  script: npm test\n" },
      ".gitlab-ci.yml",
    );
    expect(report.workflowCount).toBe(2);
    expect(report.findings.some((f) => f.ruleId === "missing-timeout-in-minutes-gitlab-ci")).toBe(
      true,
    );
  },
);

test("does not fetch or pretend to resolve conditional, variable, wildcard or external includes", async () => {
  const { report } = await scan({
    ".gitlab-ci.yml": [
      "include:",
      "  - local: ci/conditional.yml",
      "    rules:",
      "      - if: '$CI_COMMIT_BRANCH == \"main\"'",
      "  - local: ci/$TARGET.yml",
      "  - local: ci/*.yml",
      "  - remote: https://example.invalid/remote.yml",
      "  - project: other/project",
      "    file: ci/project.yml",
      "  - template: Jobs/Build.gitlab-ci.yml",
      "  - local: ci/inputs.yml",
      "    inputs:",
      "      name: test",
    ].join("\n"),
    "ci/conditional.yml": "tests:\n  script: npm test\n",
    "ci/inputs.yml": "tests:\n  script: npm test\n",
  });
  expect(report.workflowCount).toBe(1);
  expect(
    report.analysisWarnings.some((w) => w.message.includes("conditional or input-parameterized")),
  ).toBe(true);
  expect(
    report.analysisWarnings.some((w) => w.message.includes("non-literal, wildcard or external")),
  ).toBe(true);
  expect(
    report.analysisWarnings.some((w) => w.message.includes("external/project/template/component")),
  ).toBe(true);
});

test("cycles and missing files are visible and do not stop unrelated includes", async () => {
  const { report } = await scan({
    ".gitlab-ci.yml": "include:\n  - ci/cycle.yml\n  - ci/missing.yml\n  - ci/ok.yml\n",
    "ci/cycle.yml": "include: .gitlab-ci.yml\n",
    "ci/ok.yml": "tests:\n  script: npm test\n",
  });
  expect(report.workflowCount).toBe(3);
  expect(report.analysisWarnings.some((w) => w.message.includes("cycle"))).toBe(true);
  expect(report.analysisWarnings.some((w) => w.message.includes("missing or unreadable"))).toBe(
    true,
  );
  expect(report.findings.some((f) => f.ruleId === "missing-timeout-in-minutes-gitlab-ci")).toBe(
    true,
  );
});

test("rejects traversal and symlinks outside the repository", async () => {
  const cwd = await tempDirs.create("apl-gitlab-safe-");
  const outside = await tempDirs.create("apl-gitlab-outside-");
  await writeRepositoryFiles(outside, { "outside.yml": "tests:\n  script: npm test\n" });
  await writeRepositoryFiles(cwd, {
    ".gitlab-ci.yml": `include:\n  - ../${path.basename(outside)}/outside.yml\n  - linked.yml\n`,
  });
  await symlink(path.join(outside, "outside.yml"), path.join(cwd, "linked.yml"));
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(report.workflowCount).toBe(1);
  expect(report.analysisWarnings.filter((w) => w.kind === "scan-warning")).toHaveLength(2);
});

test("included parse errors retain GitLab parser diagnostics and source", async () => {
  const { report } = await scan({
    ".gitlab-ci.yml": "include: ci/broken.yml\n",
    "ci/broken.yml": "tests: [",
  });
  expect(
    report.analysisWarnings.some(
      (w) => w.kind === "parser-error" && w.source.endsWith("ci/broken.yml"),
    ),
  ).toBe(true);
});

test("does not audit templates, overridden jobs or unresolved extends as independent jobs", async () => {
  const { report } = await scan({
    ".gitlab-ci.yml":
      "include: ci/jobs.yml\ntests:\n  script: echo overridden\n  timeout: 10m\ninherited_test:\n  extends: .base\n",
    "ci/jobs.yml":
      ".base:\n  script: npm test\n  timeout: 10m\ntests:\n  script: npm test\nindependent_test:\n  script: npm test\n",
  });
  const findings = report.findings.filter(
    (f) => f.ruleId === "missing-timeout-in-minutes-gitlab-ci",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("independent_test");
  expect(report.analysisWarnings.some((w) => w.message.includes("override/extends"))).toBe(true);
});

test("traversal is bounded", async () => {
  const files: Record<string, string> = { ".gitlab-ci.yml": "include: ci/0.yml\n" };
  for (let i = 0; i < 40; i++) {
    files[`ci/${i}.yml`] = `include: ci/${i + 1}.yml\n`;
  }
  const { report } = await scan(files);
  expect(report.workflowCount).toBeLessThan(40);
  expect(report.analysisWarnings.some((w) => w.message.includes("traversal limit"))).toBe(true);
});
