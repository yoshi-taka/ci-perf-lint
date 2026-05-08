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

describe("analyzeRepository workflow and execution rules: docker misc", () => {
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

  test("reports when Dockerfile copies build.gradle.kts but only build.gradle exists", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-copy-gradle-mismatch-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "build.gradle"), 'plugins { id("java") }');
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      [
        "FROM gradle:jdk21",
        "COPY build.gradle.kts .",
        "RUN gradle build -x bootJar",
        "COPY . .",
        "RUN gradle build",
      ].join("\n"),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
        "          push: false",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((c) => c.ruleId === "docker-cache-copy-path-mismatch");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("build.gradle.kts");
    expect(finding?.message).toContain("build.gradle");
    expect(finding?.location.path).toContain("Dockerfile");
    expect(finding?.location.line).toBe(2);
  });

  test("reports when Dockerfile copies build.gradle but only build.gradle.kts exists", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-copy-gradle-mismatch2-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "build.gradle.kts"), 'plugins { id("java") }');
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM gradle:jdk21", "COPY build.gradle .", "RUN gradle build -x bootJar"].join("\n"),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
        "          push: false",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((c) => c.ruleId === "docker-cache-copy-path-mismatch");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("build.gradle");
    expect(finding?.message).toContain("build.gradle.kts");
  });

  test("skips when copied Gradle file actually exists", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-copy-gradle-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "build.gradle.kts"), 'plugins { id("java") }');
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM gradle:jdk21", "COPY build.gradle.kts .", "RUN gradle build -x bootJar"].join("\n"),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
        "          push: false",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === "docker-cache-copy-path-mismatch")).toBe(false);
  });

  test("skips when no alternative Gradle file exists", async () => {
    const fixtureRoot = await tempDirs.create("apl-docker-copy-non-existent-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      ["FROM gradle:jdk21", "COPY build.gradle.kts .", "RUN gradle build -x bootJar"].join("\n"),
    );
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: docker/build-push-action@v6",
        "        with:",
        "          context: .",
        "          push: false",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((c) => c.ruleId === "docker-cache-copy-path-mismatch")).toBe(false);
  });

  test("warns for unused zip in container even when later step contains unzip (word boundary fix)", async () => {
    const fixtureRoot = await tempDirs.create("apl-unused-zip-unzip-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    container: ubuntu:22.04",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - name: Install zip",
        "        run: apt-get update && apt-get install -y zip",
        "      - name: Unzip something",
        "        run: unzip archive.zip",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "wasteful-package-install-in-container",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("zip");
  });

  test("warns for unused jq in container even when later step has .jq path (substring match fix)", async () => {
    const fixtureRoot = await tempDirs.create("apl-unused-jq-path-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    container: ubuntu:22.04",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - name: Install jq",
        "        run: apt-get update && apt-get install -y jq",
        "      - name: Process config",
        "        run: cat config.jq",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "wasteful-package-install-in-container",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("jq");
  });

  test("warns for unused git in container when later step only mentions github (substring match fix)", async () => {
    const fixtureRoot = await tempDirs.create("apl-unused-git-github-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: ci",
        "on: push",
        "jobs:",
        "  test:",
        "    container: ubuntu:22.04",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Install packages",
        "        run: apt-get update && apt-get install -y git",
        "      - name: Checkout from github",
        "        uses: actions/checkout@v4",
        "      - name: Run tests",
        "        run: npm ci && npm test",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "wasteful-package-install-in-container",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("git");
  });
});
