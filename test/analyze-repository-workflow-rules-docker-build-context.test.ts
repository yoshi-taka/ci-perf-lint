import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("analyzeRepository workflow and execution rules: docker build and dockerfile rules", () => {
  test("warns when a Docker build context is missing .dockerignore and the Dockerfile copies broad context before deps", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.dockerBuildContextLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const dockerignoreFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-dockerignore-for-build-context",
    );
    const copyOrderFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-copies-all-before-deps",
    );

    expect(report.workflowCount).toBe(1);
    expect(dockerignoreFinding?.severity).toBe("warning");
    expect(dockerignoreFinding?.message).toContain(".dockerignore");
    expect(copyOrderFinding?.severity).toBe("warning");
    expect(copyOrderFinding?.message).toContain(
      "copies broad source context before running dependency installation",
    );
    expect(copyOrderFinding?.location.path).toBe("Dockerfile");
    expect(copyOrderFinding?.location.line).toBe(3);
  });

  test("does not flag optimized Docker build context and Dockerfile ordering", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.dockerBuildContextOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "missing-dockerignore-for-build-context",
      ),
    ).toBe(false);
    expect(
      report.findings.some((candidate) => candidate.ruleId === "dockerfile-copies-all-before-deps"),
    ).toBe(false);
  });

  test("errors on COPY --link when cache reuse is unlikely", async () => {
    const fixtureRoot = await tempDirs.create("apl-copy-link-bad-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM node:22 AS builder",
        "WORKDIR /app",
        "COPY --link package.json ./",
        "RUN npm ci",
        "COPY --link src/ ./src/",
        "RUN npm run build",
        "",
        "FROM nginx:alpine",
        "COPY --link dist/ /usr/share/nginx/html/",
        "RUN chmod -R 755 /usr/share/nginx/html",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "dockerfile-copy-link-without-cache-benefit",
    );

    expect(findings).toHaveLength(3);
    expect(findings.every((finding) => finding.severity === "error")).toBe(true);
    expect(findings.map((finding) => finding.location.line)).toEqual([3, 5, 9]);
    expect(findings[0]?.message).toContain("small manifest-style files");
    expect(findings[1]?.message).toContain("before the final Docker stage");
    expect(findings[2]?.message).toContain("later RUN instruction modifies");
  });

  test("allows final-stage COPY --link for generated artifact directories", async () => {
    const fixtureRoot = await tempDirs.create("apl-copy-link-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM node:22 AS builder",
        "WORKDIR /app",
        "COPY package.json package-lock.json ./",
        "RUN npm ci",
        "COPY . .",
        "RUN npm run build",
        "",
        "FROM nginx:alpine",
        "COPY --link dist/ /usr/share/nginx/html/",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-copy-link-without-cache-benefit",
      ),
    ).toBe(false);
  });

  test("warns when .dockerignore misses noisy build context roots", async () => {
    const fixtureRoot = await tempDirs.create("apl-weak-dockerignore-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "node_modules"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "dist"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), ".git\ncoverage\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM node:22", "WORKDIR /app", "COPY package.json ./", 'CMD ["node"]'].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "weak" }));

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerignore-misses-noisy-build-context-paths",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.location.path).toBe(".dockerignore");
    expect(finding?.message).toContain("node_modules");
    expect(finding?.message).toContain("dist");
  });

  test("warns when .dockerignore misses experimental artifact dirs at root", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-artifact-root-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "wandb"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "lightning_logs"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), ".git\nnode_modules\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM node:22", "WORKDIR /app", "COPY package.json ./", 'CMD ["node"]'].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "test" }));

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerignore-misses-noisy-build-context-paths",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("wandb");
    expect(finding?.message).toContain("lightning_logs");
  });

  test("does not flag experimental artifact dirs in subdirectories for docker", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-artifact-subdir-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "src", "runs", "run1"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), ".git\n.github\nnode_modules\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM node:22", "WORKDIR /app", "COPY package.json ./", 'CMD ["node"]'].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "test" }));

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerignore-misses-noisy-build-context-paths",
    );

    expect(finding).toBeUndefined();
  });

  test("treats dotfile wildcard dockerignore patterns as covering .git and .github", async () => {
    const fixtureRoot = await tempDirs.create("apl-dot-wildcard-dockerignore-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, ".git"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), ".*\n!package.json\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM node:22", "COPY package.json ./", 'CMD ["node"]'].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "dot-wildcard" }),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerignore-misses-noisy-build-context-paths",
      ),
    ).toBe(false);
  });

  test("warns for apt and apk installs that leave package metadata in image layers", async () => {
    const fixtureRoot = await tempDirs.create("apl-os-package-dockerfile-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), "node_modules\n.git\ndist\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM node:22",
        "RUN apt-get update && apt-get install -y ffmpeg",
        "",
        "FROM alpine",
        "RUN apk add --update curl",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "os-pkgs" }));

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const aptFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-apt-install-without-cleanup-or-cache-mount",
    );
    const apkFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-apk-add-without-no-cache-or-cache-mount",
    );

    expect(aptFinding?.severity).toBe("warning");
    expect(aptFinding?.location.line).toBe(2);
    expect(apkFinding?.severity).toBe("warning");
    expect(apkFinding?.location.line).toBe(5);
  });

  test("does not treat global npm package installs as npm ci candidates", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-npm-global-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), "node_modules\n.git\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM node:22", "RUN npm install -g --silent cowsay@1.6.0"].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "docker-global" }),
    );
    await writeFile(path.join(fixtureRoot, "package-lock.json"), "{}\n");

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-uses-npm-install-with-lockfile",
      ),
    ).toBe(false);
  });

  test("does not treat global yarn or bun package installs as lockfile install findings", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-global-yarn-bun-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), "node_modules\n.git\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM node:22", "RUN yarn global add cowsay", "RUN bun add -g cowsay"].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "docker-global-yarn-bun" }),
    );
    await writeFile(path.join(fixtureRoot, "yarn.lock"), "\n");
    await writeFile(path.join(fixtureRoot, "bun.lockb"), "\n");

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) =>
          candidate.ruleId === "dockerfile-yarn-install-without-immutable-lockfile" ||
          candidate.ruleId === "dockerfile-bun-install-without-frozen-lockfile",
      ),
    ).toBe(false);
  });

  test("treats allowlist-style dockerignore patterns as covering noisy roots", async () => {
    const fixtureRoot = await tempDirs.create("apl-dockerignore-allowlist-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, ".git"), { recursive: true });
    await mkdir(path.join(fixtureRoot, ".github"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".dockerignore"),
      ["*", "!lib", "!package*.json", "!index.js"].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM node:22", "COPY package.json ./", 'CMD ["node"]'].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "allowlist" }));

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) =>
          candidate.ruleId === "missing-dockerignore-for-build-context" ||
          candidate.ruleId === "dockerignore-misses-noisy-build-context-paths",
      ),
    ).toBe(false);
  });

  test("does not warn when apt and apk installs clean or use package cache controls", async () => {
    const fixtureRoot = await tempDirs.create("apl-os-package-dockerfile-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), "node_modules\n.git\ndist\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM node:22",
        "RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*",
        "",
        "FROM alpine",
        "RUN apk add --no-cache curl",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "os-ok" }));

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-apt-install-without-cleanup-or-cache-mount",
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-apk-add-without-no-cache-or-cache-mount",
      ),
    ).toBe(false);
  });

  test("warns when apt install omits no-install-recommends", async () => {
    const fixtureRoot = await tempDirs.create("apl-apt-recommends-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), "node_modules\n.git\ndist\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM debian:bookworm-slim",
        "RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-apt-install-without-no-install-recommends",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.location.line).toBe(2);
    expect(finding?.suggestion).toContain("--no-install-recommends");
  });

  test("warns for local ADD and floating Docker base image tags", async () => {
    const fixtureRoot = await tempDirs.create("apl-add-floating-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(fixtureRoot, "app"), { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), "node_modules\n.git\ndist\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM node:latest", "ADD app/ /app/"].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "app", "index.js"), "console.log('ok');\n");

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const addFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-add-without-clear-need",
    );
    const floatingTagFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-base-image-uses-floating-tag",
    );

    expect(addFinding?.severity).toBe("warning");
    expect(addFinding?.location.line).toBe(2);
    expect(addFinding?.suggestion).toContain("COPY");
    expect(floatingTagFinding?.severity).toBe("warning");
    expect(floatingTagFinding?.location.line).toBe(1);
  });

  test("warns when the final Docker stage copies the broad build context", async () => {
    const fixtureRoot = await tempDirs.create("apl-final-copy-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  docker:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, ".dockerignore"), "node_modules\n.git\ndist\n");
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM node:22 AS build",
        "WORKDIR /app",
        "COPY package.json ./",
        "RUN npm ci",
        "",
        "FROM node:22",
        "WORKDIR /app",
        "COPY . .",
      ].join("\n"),
    );
    await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "final-copy" }));

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-final-stage-copies-broad-context",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.location.line).toBe(8);
    expect(finding?.suggestion).toContain("multi-stage");
  });

  test("warns when one CI job builds multiple Docker images without buildx bake", async () => {
    const fixtureRoot = await tempDirs.create("apl-multi-docker-build-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  images:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: docker buildx build -f service-a/Dockerfile service-a",
        "      - run: docker buildx build -f service-b/Dockerfile service-b",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-buildx-bake-for-multiple-images",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain('Job "images"');
    expect(finding?.suggestion).toContain("docker-bake.hcl");
  });

  test("warns when a Docker bake file exists but CI bypasses buildx bake", async () => {
    const fixtureRoot = await tempDirs.create("apl-unused-bake-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "docker-bake.hcl"), 'group "default" {}\n');
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  image:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: docker buildx build --push .",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "docker-bake-file-unused-in-ci",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("Docker bake file");
    expect(finding?.suggestion).toContain("docker buildx bake");
  });

  test("does not warn about Docker bake when CI already uses buildx bake", async () => {
    const fixtureRoot = await tempDirs.create("apl-bake-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "docker-bake.hcl"), 'group "default" {}\n');
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  image:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: docker buildx bake --push",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) =>
          candidate.ruleId === "prefer-buildx-bake-for-multiple-images" ||
          candidate.ruleId === "docker-bake-file-unused-in-ci",
      ),
    ).toBe(false);
  });

  test("warns when CI uses legacy docker build instead of buildx build", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-build-legacy-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  image:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: docker build -t app .",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-buildx-build-over-docker-build",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.suggestion).toContain("docker buildx build");
  });

  test("warns when CI disables Docker build cache", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-no-cache-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  image:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: docker buildx build --no-cache -t app .",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "docker-build-cache-disabled-in-ci",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.suggestion).toContain("no-cache");
  });

  test("does not warn when Docker build cache remains enabled or only a targeted cache filter is used", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-cache-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  action:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
        "          no-cache: false",
        "  shell:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: docker buildx build --no-cache-filter deps -t app .",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((finding) => finding.ruleId === "docker-build-cache-disabled-in-ci"),
    ).toBe(false);
  });

  test("warns when a job runs multiple separate go build commands", async () => {
    const fixtureRoot = await tempDirs.create("apl-multiple-go-builds-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go build -o bin/app1 ./cmd/app1",
        "      - run: go build -o bin/app2 ./cmd/app2",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "collapse-multiple-go-builds-in-job",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("2 separate `go build` commands");
  });

  test("does not warn when go build already builds multiple packages together", async () => {
    const fixtureRoot = await tempDirs.create("apl-multiple-go-builds-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go build ./cmd/app1 ./cmd/app2",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "collapse-multiple-go-builds-in-job",
      ),
    ).toBe(false);
  });

  test("warns when go test repeats vet after a go vet step", async () => {
    const fixtureRoot = await tempDirs.create("apl-go-test-vet-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go vet ./...",
        "      - run: go test ./...",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "go-test-repeats-vet-after-go-vet",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.suggestion).toContain("-vet=off");
  });

  test("warns when broad go build runs before broad race go test", async () => {
    const fixtureRoot = await tempDirs.create("apl-go-race-build-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go build ./...",
        "      - run: go test -race ./...",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "go-build-before-race-test",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("go test");
    expect(finding?.suggestion).toContain("cache warmer");
  });

  test("warns when broad go test is serialized with p one", async () => {
    const fixtureRoot = await tempDirs.create("apl-go-test-p-one-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go test -p 1 ./...",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "go-test-broad-package-serial-p-one",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("-p 1");
  });

  test("does not warn when go test disables vet after go vet", async () => {
    const fixtureRoot = await tempDirs.create("apl-go-test-vet-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-go@v5",
        "      - run: go vet ./...",
        "      - run: go test -vet=off ./...",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) =>
          candidate.ruleId === "go-test-repeats-vet-after-go-vet" ||
          candidate.ruleId === "go-build-before-race-test" ||
          candidate.ruleId === "go-test-broad-package-serial-p-one",
      ),
    ).toBe(false);
  });

  test("warns when pushed Docker build action omits zstd compression", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-zstd-action-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  image:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
        "          push: true",
        "          tags: ghcr.io/acme/app:${{ github.sha }}",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-zstd-compression-for-pushed-docker-images",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.suggestion).toContain("compression=zstd");
  });

  test("warns when shell buildx push omits zstd compression", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-zstd-shell-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  image:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: docker buildx build --push -t ghcr.io/acme/app:${{ github.sha }} .",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-zstd-compression-for-pushed-docker-images",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.measurementHint).toContain("pull time");
  });

  test("does not warn when pushed Docker build already requests zstd compression", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-zstd-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  image:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: depot/build-push-action@v1",
        "        with:",
        "          context: .",
        "          push: true",
        "          outputs: compression=zstd,oci-mediatypes=true",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-zstd-compression-for-pushed-docker-images",
      ),
    ).toBe(false);
  });

  test("warns for subdirectory Docker build contexts found via shell docker build arguments", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.dockerBuildContextSubdirLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const dockerignoreFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-dockerignore-for-build-context",
    );
    const copyOrderFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-copies-all-before-deps",
    );

    expect(report.workflowCount).toBe(1);
    expect(dockerignoreFinding?.message).toContain("`apps/web`");
    expect(copyOrderFinding?.location.path).toBe("apps/web/Dockerfile");
    expect(copyOrderFinding?.location.line).toBe(3);
  });

  test("warns for docker compose build contexts resolved from compose.yaml", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.dockerBuildContextComposeLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const dockerignoreFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-dockerignore-for-build-context",
    );
    const copyOrderFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-copies-all-before-deps",
    );

    expect(report.workflowCount).toBe(1);
    expect(dockerignoreFinding?.message).toContain("`apps/web`");
    expect(copyOrderFinding?.location.path).toBe("apps/web/Dockerfile");
  });

  test("warns when a uses: field references a repo without @ref, docker://, or ./ qualifier", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.avoidDockerImageViaUsesLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "avoid-docker-image-via-uses",
    );
    const dangerFinding = findings.find((f) => f.message.includes("danger/danger-js"));

    expect(report.workflowCount).toBe(1);
    expect(findings.length).toBe(2);
    expect(dangerFinding?.severity).toBe("warning");
    expect(dangerFinding?.confidence).toBe("high");
    expect(dangerFinding?.message).toContain("danger/danger-js");
    expect(dangerFinding?.location.line).toBe(12);
  });

  test("does not flag uses: with docker://, @ref, or ./ qualifiers", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.avoidDockerImageViaUsesOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "avoid-docker-image-via-uses"),
    ).toBe(false);
  });

  test("warns when a containerized job installs OS packages not used in later steps", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.wastefulPackageInstallInContainerLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "wasteful-package-install-in-container",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.confidence).toBe("high");
    expect(finding?.message).toContain("jq");
    expect(finding?.message).toContain("container");
  });

  test("does not flag container installs when the package is used or job is not containerized", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.wastefulPackageInstallInContainerOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "wasteful-package-install-in-container",
      ),
    ).toBe(false);
  });

  test("warns when docker/build-push-action has load: true but the image is unused", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.dockerBuildLoadTrueLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "docker-build-load-true-unnecessary",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("load: true");
  });

  test("does not warn when load: true is followed by docker run", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.dockerBuildLoadTrueOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "docker-build-load-true-unnecessary",
      ),
    ).toBe(false);
  });

  test("does not warn when load: true is followed by docker compose", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.dockerBuildLoadTrueComposeOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "docker-build-load-true-unnecessary",
      ),
    ).toBe(false);
  });

  test("does not warn when tags use a dynamic expression", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.dockerBuildLoadTrueDynamicOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "docker-build-load-true-unnecessary",
      ),
    ).toBe(false);
  });
});
