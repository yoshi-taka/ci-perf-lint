import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { parseWorkflow } from "../src/workflow.ts";
import { collectDockerBuildTargets } from "../src/repository-diagnostics/docker-build-targets.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
async function scan(
  steps: Record<string, unknown>[],
  files: Record<string, string> = {},
  container?: string,
) {
  const cwd = await tempDirs.create("apl-docker-command-evidence-");
  const source = stringify({
    on: "push",
    jobs: { verify: { "runs-on": "ubuntu-latest", ...(container ? { container } : {}), steps } },
  });
  await writeRepositoryFiles(cwd, { ".github/workflows/ci.yml": source, ...files });
  const workflow = parseWorkflow(`${cwd}/.github/workflows/ci.yml`, cwd, source);
  const targets = await collectDockerBuildTargets(cwd, [workflow]);
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "exploratory",
    topCount: 1000,
    repositoryVisibility: "public",
  });
  return { cwd, targets, report };
}

test.each([
  "echo 'docker build -f Dockerfile.Other .'",
  "# docker build -f Dockerfile.Other .\necho audit",
  "grep 'docker build -f Dockerfile.Other .' notes.txt",
  "echo '$(docker build -f Dockerfile.Other .)'",
])("displayed builds cannot invent Dockerfile diagnostics: %s", async (run) => {
  const { targets, report } = await scan([{ run: "docker build ." }, { run }], {
    Dockerfile: "FROM alpine:3.22\n",
    "Dockerfile.Other": "FROM node:22\nCOPY package*.json ./\nRUN npm install\n",
    "package.json": '{"name":"sample","version":"1.0.0"}',
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
  });
  expect(targets).toHaveLength(1);
  expect(targets[0]?.dockerfilePath).not.toEndWith("Dockerfile.Other");
  expect(report.findings.some((f) => f.location.path === "Dockerfile.Other")).toBe(false);
});

test.each([
  "docker build -f Dockerfile.Other .",
  'echo "$(docker build -f Dockerfile.Other .)"',
  "sudo -n docker buildx build --label 'docker build -f ignored .' --target prod -f Dockerfile.Other .",
])("real build owns its file/target options: %s", async (run) => {
  const { targets, report } = await scan([{ run }], {
    "Dockerfile.Other": "FROM node:22 AS prod\nCOPY package*.json ./\nRUN npm install\n",
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
    "package.json": '{"name":"sample"}',
  });
  expect(targets).toHaveLength(1);
  expect(targets[0]?.dockerfilePath).toEndWith("Dockerfile.Other");
  expect(
    report.findings.some((f) => f.ruleId === "dockerfile-uses-npm-install-with-lockfile"),
  ).toBe(true);
});

test.each([
  "echo 'docker compose -f compose.yml build app'",
  "# docker compose -f compose.yml build app\necho audit",
  "grep 'docker compose -f compose.yml build app' notes.txt",
])("compose configuration is not selected by displayed commands: %s", async (run) => {
  const { targets } = await scan([{ run }], {
    "compose.yml": "services:\n  app:\n    build: .\n",
    Dockerfile: "FROM alpine:3.22\n",
  });
  expect(targets).toHaveLength(0);
});

test.each([
  "docker compose -f compose.yml build app",
  'echo "$(docker compose -f compose.yml build app)"',
])("real compose build retains structured target resolution: %s", async (run) => {
  const { targets } = await scan([{ run }], {
    "compose.yml": "services:\n  app:\n    build: .\n",
    Dockerfile: "FROM alpine:3.22\n",
  });
  expect(targets).toHaveLength(1);
  expect(targets[0]?.dockerfilePath).toEndWith("/Dockerfile");
});

test.each([
  "echo audit",
  "echo 'DOCKER_HOST=tcp://other'",
  "# DOCKER_HOST=tcp://other\necho audit",
  "echo 'docker buildx create --name other'",
  "# docker buildx use other\necho audit",
])("logs cannot reset persistent-builder state: %s", async (run) => {
  const { targets, report } = await scan(
    [{ uses: "useblacksmith/setup-docker-builder@v1" }, { run }, { run: "docker buildx build ." }],
    {
      Dockerfile: "FROM rust:1.90\nRUN cargo build --release\n",
      "Cargo.toml": '[package]\nname="sample"\nversion="0.1.0"\n',
      "src/main.rs": "fn main() {}\n",
    },
  );
  expect(targets[0]?.cacheMountPersistence).toBe("blacksmith");
  expect(
    report.findings.some((f) => f.ruleId === "dockerfile-cargo-build-release-without-cache-mount"),
  ).toBe(true);
});

test.each([
  "export DOCKER_HOST=tcp://other",
  "docker buildx create --name other --use",
  'echo "DOCKER_HOST=tcp://other" >> $GITHUB_ENV',
  "sudo -n DOCKER_CONTEXT=other docker buildx build .",
])("actual builder changes/env writes invalidate persistence: %s", async (run) => {
  const { targets, report } = await scan(
    [{ uses: "useblacksmith/setup-docker-builder@v1" }, { run }, { run: "docker buildx build ." }],
    {
      Dockerfile: "FROM rust:1.90\nRUN cargo build --release\n",
      "Cargo.toml": '[package]\nname="sample"\nversion="0.1.0"\n',
      "src/main.rs": "fn main() {}\n",
    },
  );
  expect(targets[0]?.cacheMountPersistence).toBeUndefined();
  expect(
    report.findings.some((f) => f.ruleId === "dockerfile-cargo-build-release-without-cache-mount"),
  ).toBe(false);
});

const containerRule = "wasteful-package-install-in-container";
test.each([
  "echo 'apt-get install -y curl'",
  "echo apt-get install -y curl",
  "# apt-get install -y curl\necho audit",
  "grep 'apk add curl' notes.txt",
])("container install must be executed, not printed: %s", async (run) => {
  const { report } = await scan([{ run }], {}, "ubuntu:24.04");
  expect(report.findings.some((f) => f.ruleId === containerRule)).toBe(false);
});

test.each([
  { run: "echo ' curl '" },
  { run: "# curl\necho audit" },
  { run: "grep curl README.md" },
  { name: "curl", run: "echo audit" },
])("later labels/output/patterns do not execute installed tools: %j", async (step) => {
  const { report } = await scan([{ run: "apt-get install -y curl" }, step], {}, "ubuntu:24.04");
  expect(report.findings.some((f) => f.ruleId === containerRule)).toBe(true);
});

test.each([
  "curl https://example.com",
  "/usr/bin/curl https://example.com",
  'echo "$(curl https://example.com)"',
])("actual later use remains evidence: %s", async (run) => {
  const { report } = await scan([{ run: "apt-get install -y curl" }, { run }], {}, "ubuntu:24.04");
  expect(report.findings.some((f) => f.ruleId === containerRule)).toBe(false);
});
