import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("analyzeRepository workflow and execution rules: docker build patterns", () => {
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
});
