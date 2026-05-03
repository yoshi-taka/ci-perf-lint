import { describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";

describe("analyzeRepository workflow and execution rules: dockerfile package and cache-mount rules", () => {
  test("warns when Rust Dockerfile installs cargo tools without locked resolution and builds release without cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerRustUncachedLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const installFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-cargo-install-without-locked",
    );
    const buildFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-cargo-build-release-without-cache-mount",
    );

    expect(report.workflowCount).toBe(1);
    expect(installFinding?.severity).toBe("warning");
    expect(installFinding?.confidence).toBe("high");
    expect(installFinding?.message).toContain("cargo install");
    expect(installFinding?.suggestion).toContain("--locked");
    expect(installFinding?.location.path).toBe("Dockerfile");
    expect(installFinding?.location.line).toBe(3);
    expect(buildFinding?.severity).toBe("warning");
    expect(buildFinding?.confidence).toBe("medium");
    expect(buildFinding?.message).toContain("cargo build --release");
    expect(buildFinding?.suggestion).toContain("BuildKit cache mounts");
    expect(buildFinding?.location.path).toBe("Dockerfile");
    expect(buildFinding?.location.line).toBe(6);
  });

  test("does not flag Rust Dockerfile with locked cargo tool install and cache-mounted release build", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerRustCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-cargo-install-without-locked",
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-cargo-build-release-without-cache-mount",
      ),
    ).toBe(false);
  });

  test("warns when Go Dockerfile downloads modules and builds without cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerGoUncachedLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const modFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-go-mod-download-without-cache-mount",
    );
    const buildFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-go-build-without-cache-mount",
    );
    const sourceLayerFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-compiled-build-copies-source-layer",
    );

    expect(report.workflowCount).toBe(1);
    expect(modFinding?.severity).toBe("warning");
    expect(modFinding?.confidence).toBe("medium");
    expect(modFinding?.message).toContain("go mod download");
    expect(modFinding?.suggestion).toContain("/go/pkg/mod");
    expect(modFinding?.location.path).toBe("Dockerfile");
    expect(modFinding?.location.line).toBe(4);
    expect(buildFinding?.severity).toBe("warning");
    expect(buildFinding?.confidence).toBe("medium");
    expect(buildFinding?.message).toContain("go build");
    expect(buildFinding?.suggestion).toContain("/root/.cache/go-build");
    expect(buildFinding?.location.path).toBe("Dockerfile");
    expect(buildFinding?.location.line).toBe(6);
    expect(sourceLayerFinding?.severity).toBe("warning");
    expect(sourceLayerFinding?.location.path).toBe("Dockerfile");
    expect(sourceLayerFinding?.location.line).toBe(5);
    expect(sourceLayerFinding?.suggestion).toContain("bind mount");
  });

  test("does not flag Go Dockerfile when module download and build use cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerGoCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-go-mod-download-without-cache-mount",
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-go-build-without-cache-mount",
      ),
    ).toBe(false);
  });

  test("warns when Maven Dockerfile resolves dependencies and builds without cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerMavenUncachedLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const offlineFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-maven-go-offline-without-cache-mount",
    );
    const buildFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-maven-build-without-cache-mount",
    );

    expect(report.workflowCount).toBe(1);
    expect(offlineFinding?.severity).toBe("warning");
    expect(offlineFinding?.confidence).toBe("medium");
    expect(offlineFinding?.message).toContain("dependency:go-offline");
    expect(offlineFinding?.suggestion).toContain("/root/.m2");
    expect(offlineFinding?.location.path).toBe("Dockerfile");
    expect(offlineFinding?.location.line).toBe(4);
    expect(buildFinding?.severity).toBe("warning");
    expect(buildFinding?.confidence).toBe("medium");
    expect(buildFinding?.message).toContain("Maven build");
    expect(buildFinding?.suggestion).toContain("/root/.m2");
    expect(buildFinding?.location.path).toBe("Dockerfile");
    expect(buildFinding?.location.line).toBe(6);
  });

  test("does not flag Maven Dockerfile when dependency resolution and build use cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerMavenCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-maven-go-offline-without-cache-mount",
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-maven-build-without-cache-mount",
      ),
    ).toBe(false);
  });

  test("warns when Gradle Dockerfile resolves dependencies and builds without cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerGradleUncachedLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const dependenciesFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-gradle-dependencies-without-cache-mount",
    );
    const buildFinding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-gradle-build-without-cache-mount",
    );

    expect(report.workflowCount).toBe(1);
    expect(dependenciesFinding?.severity).toBe("warning");
    expect(dependenciesFinding?.confidence).toBe("medium");
    expect(dependenciesFinding?.message).toContain("Gradle dependency resolution");
    expect(dependenciesFinding?.suggestion).toContain("Gradle user home");
    expect(dependenciesFinding?.location.path).toBe("Dockerfile");
    expect(dependenciesFinding?.location.line).toBe(4);
    expect(buildFinding?.severity).toBe("warning");
    expect(buildFinding?.confidence).toBe("medium");
    expect(buildFinding?.message).toContain("Gradle build");
    expect(buildFinding?.suggestion).toContain("Gradle user home");
    expect(buildFinding?.location.path).toBe("Dockerfile");
    expect(buildFinding?.location.line).toBe(6);
  });

  test("does not flag Gradle Dockerfile when dependency resolution and build use cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerGradleCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-gradle-dependencies-without-cache-mount",
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-gradle-build-without-cache-mount",
      ),
    ).toBe(false);
  });

  test("warns when Ruby Dockerfile runs bundle install without cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerRubyUncachedLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "dockerfile-bundle-install-without-cache-mount",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.confidence).toBe("medium");
    expect(finding?.message).toContain("bundle install");
    expect(finding?.suggestion).toContain("/usr/local/bundle/cache");
    expect(finding?.location.path).toBe("Dockerfile");
    expect(finding?.location.line).toBe(4);
  });

  test("does not flag Ruby Dockerfile when bundle install uses cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerRubyCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "dockerfile-bundle-install-without-cache-mount",
      ),
    ).toBe(false);
  });

  test("warns when docker/build-push-action is used without cache-from and cache-to", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerBuildWithoutLayerCacheLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "docker-build-without-layer-cache",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.confidence).toBe("high");
    expect(finding?.message).toContain("cache-from");
    expect(finding?.suggestion).toContain("type=gha");
  });

  test("does not warn when docker/build-push-action has cache-from and cache-to", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerBuildWithoutLayerCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "docker-build-without-layer-cache"),
    ).toBe(false);
  });

  test("does not warn when depot/build-push-action has cache-from and cache-to", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerBuildWithoutLayerCacheDepotOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "docker-build-without-layer-cache"),
    ).toBe(false);
  });

  test("does not warn when docker/build-push-action has no-cache: true", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerBuildWithoutLayerCacheNocacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "docker-build-without-layer-cache"),
    ).toBe(false);
  });
});
