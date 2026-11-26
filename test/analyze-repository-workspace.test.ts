import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const workflow = [
  "name: CI",
  "on: push",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: docker build --no-cache .",
].join("\n");

test("a workspace parent analyses each nested repository separately", async () => {
  const cwd = await tempDirs.create("apl-workspace-");
  await writeRepositoryFiles(cwd, {
    "service-a/.git/HEAD": "ref: refs/heads/main\n",
    "service-a/.github/workflows/ci.yml": workflow,
    "service-b/.git/HEAD": "ref: refs/heads/main\n",
    "service-b/.github/workflows/ci.yml": workflow,
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  expect(report.targetPath).toBe(cwd);
  expect(report.workflowCount).toBe(2);
  expect(
    report.analysisWarnings.some((warning) => warning.message.includes("nested repositories")),
  ).toBe(true);
  const paths = report.findings
    .filter((finding) => finding.ruleId === "docker-build-cache-disabled-in-ci")
    .map((finding) => finding.location.path)
    .sort();
  expect(paths).toEqual([
    "service-a/.github/workflows/ci.yml",
    "service-b/.github/workflows/ci.yml",
  ]);
});

test("a git repository is not split into child repositories", async () => {
  const cwd = await tempDirs.create("apl-workspace-repo-");
  await writeRepositoryFiles(cwd, {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".github/workflows/ci.yml": workflow,
    "nested/.git/HEAD": "ref: refs/heads/main\n",
    "nested/.github/workflows/ci.yml": workflow,
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  expect(report.workflowCount).toBe(1);
  expect(report.findings.some((finding) => finding.location.path.startsWith("nested/"))).toBe(
    false,
  );
});
