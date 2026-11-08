import { afterEach, expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import path from "node:path";
import { collectWorkflowFiles, resolveWorkflowTarget } from "../src/fs.ts";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const pipeline = "steps:\n  - command: npm test\n";

for (const directory of [".buildkite", "buildkite"]) {
  test(`recursively discovers static pipelines, not configuration YAML: ${directory}`, async () => {
    const root = await tempDirs.create("apl-bk-discovery-");
    await writeRepositoryFiles(root, {
      [`${directory}/pipeline.yml`]: pipeline,
      [`${directory}/pipelines/test.yml`]: pipeline,
      [`${directory}/pipelines/release/deploy.yaml`]: pipeline,
      [`${directory}/pipelines/release/jobs.json`]: JSON.stringify({
        steps: [{ command: "npm test" }],
      }),
      [`${directory}/pipelines/array.yml`]: "- command: npm test\n",
      [`${directory}/pipelines/group.yml`]:
        "steps:\n  - group: tests\n    steps:\n      - command: npm test\n",
      [`${directory}/pipelines/empty.yml`]: "steps: []\n",
      [`${directory}/moon.yml`]: "tasks:\n  test:\n    command: npm test\n",
      [`${directory}/ftr/config.yml`]: "- ./path/test.config.ts\n",
      [`${directory}/resource-definitions/pr.yml`]:
        "kind: Resource\nspec:\n  implementation:\n    steps:\n      - command: npm test\n",
      [`${directory}/scripts/generator.sh`]: "exit 1\n",
      [`${directory}/node_modules/example/pipeline.yml`]: pipeline,
      ".github/workflows/check.yml": "on: push\njobs: {}\n",
    });
    const files = await collectWorkflowFiles(await resolveWorkflowTarget(root));
    expect(files.map((file) => path.relative(root, file))).toEqual(
      [
        `${directory}/pipeline.yml`,
        `${directory}/pipelines/array.yml`,
        `${directory}/pipelines/empty.yml`,
        `${directory}/pipelines/group.yml`,
        `${directory}/pipelines/release/deploy.yaml`,
        `${directory}/pipelines/release/jobs.json`,
        `${directory}/pipelines/test.yml`,
        ".github/workflows/check.yml",
      ].sort((a, b) => a.localeCompare(b)),
    );
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      workflowOnly: true,
      mode: "exploratory",
      topCount: 100,
    });
    expect(
      report.findings.some(
        (f) =>
          f.ruleId === "missing-timeout-in-minutes-buildkite" &&
          f.location.path === `${directory}/pipelines/release/deploy.yaml`,
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (f) =>
          f.ruleId === "missing-timeout-in-minutes-buildkite" &&
          f.location.path === `${directory}/pipelines/release/jobs.json`,
      ),
    ).toBe(true);
  });
}

test("nested file and directory targets preserve repository root and selection", async () => {
  const root = await tempDirs.create("apl-bk-nested-target-");
  await writeRepositoryFiles(root, {
    ".buildkite/pipelines/release/deploy.yml": pipeline,
    ".buildkite/pipelines/other.yml": pipeline,
  });
  const file = path.join(root, ".buildkite/pipelines/release/deploy.yml");
  for (const targetPath of [file, path.dirname(file)]) {
    const target = await resolveWorkflowTarget(targetPath);
    expect(target.repoRoot).toBe(root);
    expect(await collectWorkflowFiles(target)).toEqual([file]);
    const report = await analyzeRepository({
      cwd: root,
      targetPath,
      workflowOnly: true,
      mode: "exploratory",
      topCount: 100,
    });
    expect(report.workflowCount).toBe(1);
    expect(report.workflows[0]?.path).toBe(".buildkite/pipelines/release/deploy.yml");
  }
});

test("discovery does not follow symlinked files or directories", async () => {
  const root = await tempDirs.create("apl-bk-symlink-");
  const external = await tempDirs.create("apl-bk-outside-");
  await writeRepositoryFiles(root, { ".buildkite/pipeline.yml": pipeline });
  await writeRepositoryFiles(external, { "other.yml": pipeline });
  await symlink(external, path.join(root, ".buildkite/linked"));
  await symlink(path.join(external, "other.yml"), path.join(root, ".buildkite/linked.yml"));
  const files = await collectWorkflowFiles(await resolveWorkflowTarget(root));
  expect(files).toEqual([path.join(root, ".buildkite/pipeline.yml")]);
});

test("malformed static pipelines still reach parser diagnostics", async () => {
  const root = await tempDirs.create("apl-bk-invalid-");
  await writeRepositoryFiles(root, {
    ".buildkite/pipelines/pipeline.yml": "steps: [",
    ".buildkite/pipelines/broken.yml": "steps:\n  - command: [",
    ".buildkite/pipelines/broken-map.yml": "steps:\n  invalid: [",
  });
  const files = await collectWorkflowFiles(await resolveWorkflowTarget(root));
  expect(files).toHaveLength(3);
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    workflowOnly: true,
    topCount: 100,
  });
  expect(report.analysisWarnings.some((w) => w.kind === "parser-error")).toBe(true);
});
