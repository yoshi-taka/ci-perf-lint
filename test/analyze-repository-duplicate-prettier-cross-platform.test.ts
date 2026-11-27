import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "avoid-duplicate-prettier-check";

async function findingsFor(files: Record<string, string>) {
  const cwd = await tempDirs.create("ci-perf-dup-prettier-cross-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({
      private: true,
      devDependencies: { prettier: "^3.0.0", eslint: "^9.0.0" },
      scripts: {
        lint: "prettier --check . && eslint .",
        "prettier-check": "prettier --check .",
      },
    }),
    "src/index.js": "export const value = 1;\n",
    ...files,
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: true,
    mode: "strict",
    topCount: 100,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test("Buildkite commands detect the duplicate check", async () => {
  const findings = await findingsFor({
    ".buildkite/pipeline.yml": [
      "steps:",
      "  - label: lint",
      "    commands:",
      "      - npm run lint",
      "  - label: prettier-check",
      "    commands:",
      "      - npm run prettier-check",
    ].join("\n"),
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.path).toBe(".buildkite/pipeline.yml");
  expect(findings[0]?.location.line).toBe(4);
  expect(findings[0]?.message).toContain("lint, prettier-check");
});

test("CircleCI steps detect the duplicate check", async () => {
  const findings = await findingsFor({
    ".circleci/config.yml": [
      "version: 2.1",
      "jobs:",
      "  lint:",
      "    docker: [{image: cimg/node:22.0}]",
      "    steps:",
      "      - run: npm run lint",
      "      - run: npm run prettier-check",
      "workflows:",
      "  ci:",
      "    jobs: [lint]",
    ].join("\n"),
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.path).toBe(".circleci/config.yml");
});

test("GitLab CI script lines detect the duplicate check", async () => {
  const findings = await findingsFor({
    ".gitlab-ci.yml": [
      "lint:",
      "  script:",
      "    - npm run lint",
      "    - npm run prettier-check",
    ].join("\n"),
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.path).toBe(".gitlab-ci.yml");
});

test("unnamed CircleCI steps fall back to job names", async () => {
  const findings = await findingsFor({
    ".circleci/config.yml": [
      "version: 2.1",
      "jobs:",
      "  lint:",
      "    docker: [{image: cimg/node:22.0}]",
      "    steps:",
      "      - run: npm run lint",
      "  format:",
      "    docker: [{image: cimg/node:22.0}]",
      "    steps:",
      "      - run: npm run prettier-check",
      "workflows:",
      "  ci:",
      "    jobs: [lint, format]",
    ].join("\n"),
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("lint, format");
  expect(findings[0]?.message).not.toContain("(unnamed)");
});
