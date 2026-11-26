import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const ruleId = "docker-build-without-layer-cache";

async function findingsFor(files: Record<string, string>) {
  const cwd = await tempDirs.create("apl-docker-cross-platform-");
  await writeRepositoryFiles(cwd, files);
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "strict",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test("CircleCI Docker builds without cache flags are reported", async () => {
  const findings = await findingsFor({
    ".circleci/config.yml": [
      "version: 2.1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - run: docker build -t app .",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.confidence).toBe("medium");
});

test("Buildkite Docker builds without cache flags are reported", async () => {
  const findings = await findingsFor({
    ".buildkite/pipeline.yml": [
      "steps:",
      "  - label: build",
      "    command: docker build -t app .",
    ].join("\n"),
  });
  expect(findings).toHaveLength(1);
});

test("GitLab CI Docker builds without cache flags are reported", async () => {
  const findings = await findingsFor({
    ".gitlab-ci.yml": ["build:", "  script:", "    - docker build -t app ."].join("\n"),
  });
  expect(findings).toHaveLength(1);
});

test("CircleCI dependency installs without cache steps are reported", async () => {
  const cwd = await tempDirs.create("apl-circleci-dependency-cache-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/node:22.0}]",
      "    steps:",
      "      - run: npm ci",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(report.findings.some((finding) => finding.ruleId === "missing-dependency-cache")).toBe(
    true,
  );
});

test("GitLab CI dependency installs without cache are reported", async () => {
  const cwd = await tempDirs.create("apl-gitlab-dependency-cache-");
  await writeRepositoryFiles(cwd, {
    ".gitlab-ci.yml": ["build:", "  script:", "    - npm ci"].join("\n"),
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(report.findings.some((finding) => finding.ruleId === "missing-dependency-cache")).toBe(
    true,
  );
});

test("CircleCI save_cache and GitLab cache suppress dependency cache findings", async () => {
  const circle = await tempDirs.create("apl-circleci-dependency-cache-ok-");
  await writeRepositoryFiles(circle, {
    ".circleci/config.yml": [
      "version: 2.1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/node:22.0}]",
      "    steps:",
      "      - restore_cache: {keys: [deps-v1]}",
      "      - run: npm ci",
      "      - save_cache: {key: deps-v1, paths: [node_modules]}",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
  });
  const circleReport = await analyzeRepository({
    cwd: circle,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(
    circleReport.findings.some((finding) => finding.ruleId === "missing-dependency-cache"),
  ).toBe(false);

  const gitlab = await tempDirs.create("apl-gitlab-dependency-cache-ok-");
  await writeRepositoryFiles(gitlab, {
    ".gitlab-ci.yml": [
      "build:",
      "  cache:",
      "    paths: [node_modules]",
      "  script:",
      "    - npm ci",
    ].join("\n"),
  });
  const gitlabReport = await analyzeRepository({
    cwd: gitlab,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(
    gitlabReport.findings.some((finding) => finding.ruleId === "missing-dependency-cache"),
  ).toBe(false);
});

test("visible cache flags and --no-cache suppress the cross-platform rule", async () => {
  const cached = await findingsFor({
    ".circleci/config.yml": [
      "version: 2.1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - run: docker buildx build --cache-from type=registry,ref=example/cache .",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
  });
  expect(cached).toHaveLength(0);

  const noCache = await findingsFor({
    ".circleci/config.yml": [
      "version: 2.1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - run: docker build --no-cache -t app .",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
  });
  expect(noCache).toHaveLength(0);
});
