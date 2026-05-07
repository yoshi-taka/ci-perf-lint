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

  test("does not crash on COPY with flags but no source/destination", async () => {
    const fixtureRoot = await tempDirs.create("apl-copy-flag-no-args-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      [
        "name: docker",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: docker build .",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM alpine",
        "COPY --link",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report).toBeDefined();
  });
});
