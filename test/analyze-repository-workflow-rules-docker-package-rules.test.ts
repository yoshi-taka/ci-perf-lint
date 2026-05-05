import { describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";

const baseOptions = { targetPath: ".", topCount: 20, mode: "strict" as const };

describe("analyzeRepository workflow and execution rules: dockerfile package and cache-mount rules", () => {
  test("warns when Rust Dockerfile installs cargo tools without locked resolution and builds release without cache mounts", async () => {
    const report = await analyzeRepository({ cwd: fixtures.dockerRustUncachedLike, ...baseOptions });

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

  test("warns when Go Dockerfile downloads modules and builds without cache mounts", async () => {
    const report = await analyzeRepository({ cwd: fixtures.dockerGoUncachedLike, ...baseOptions });

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

  test("warns when Maven Dockerfile resolves dependencies and builds without cache mounts", async () => {
    const report = await analyzeRepository({ cwd: fixtures.dockerMavenUncachedLike, ...baseOptions });

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

  test("warns when Gradle Dockerfile resolves dependencies and builds without cache mounts", async () => {
    const report = await analyzeRepository({ cwd: fixtures.dockerGradleUncachedLike, ...baseOptions });

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

  describe("negative cases: no warning when cache mounts are used", () => {
    const negativeCases = [
      { name: "Rust", fixture: fixtures.dockerRustCacheOk, ruleIds: ["dockerfile-cargo-install-without-locked", "dockerfile-cargo-build-release-without-cache-mount"] as const },
      { name: "Go", fixture: fixtures.dockerGoCacheOk, ruleIds: ["dockerfile-go-mod-download-without-cache-mount", "dockerfile-go-build-without-cache-mount"] as const },
      { name: "Maven", fixture: fixtures.dockerMavenCacheOk, ruleIds: ["dockerfile-maven-go-offline-without-cache-mount", "dockerfile-maven-build-without-cache-mount"] as const },
      { name: "Gradle", fixture: fixtures.dockerGradleCacheOk, ruleIds: ["dockerfile-gradle-dependencies-without-cache-mount", "dockerfile-gradle-build-without-cache-mount"] as const },
      { name: "Ruby", fixture: fixtures.dockerRubyCacheOk, ruleIds: ["dockerfile-bundle-install-without-cache-mount"] as const },
    ];

    test.each(negativeCases)("does not flag $name Dockerfile when cache mounts are used", async ({ fixture, ruleIds }) => {
      const report = await analyzeRepository({ cwd: fixture, ...baseOptions });
      for (const ruleId of ruleIds) {
        expect(report.findings.some((c) => c.ruleId === ruleId)).toBe(false);
      }
    });
  });

  test("warns when Ruby Dockerfile runs bundle install without cache mounts", async () => {
    const report = await analyzeRepository({ cwd: fixtures.dockerRubyUncachedLike, ...baseOptions });

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

  describe("docker/build-push-action layer cache", () => {
    test("warns when docker/build-push-action is used without cache-from and cache-to", async () => {
      const report = await analyzeRepository({ cwd: fixtures.dockerBuildWithoutLayerCacheLike, ...baseOptions });

      const finding = report.findings.find(
        (candidate) => candidate.ruleId === "docker-build-without-layer-cache",
      );

      expect(report.workflowCount).toBe(1);
      expect(finding?.severity).toBe("warning");
      expect(finding?.confidence).toBe("high");
      expect(finding?.message).toContain("cache-from");
      expect(finding?.suggestion).toContain("type=gha");
    });

    type NoWarningCase = { name: string; fixture: string };

    const noWarningCases: NoWarningCase[] = [
      { name: "does not warn when cache-from and cache-to are set", fixture: fixtures.dockerBuildWithoutLayerCacheOk },
      { name: "does not warn for depot/build-push-action with cache config", fixture: fixtures.dockerBuildWithoutLayerCacheDepotOk },
      { name: "does not warn when no-cache: true is set", fixture: fixtures.dockerBuildWithoutLayerCacheNocacheOk },
    ];

    test.each(noWarningCases)("$name", async ({ fixture }) => {
      const report = await analyzeRepository({ cwd: fixture, ...baseOptions });
      expect(
        report.findings.some((c) => c.ruleId === "docker-build-without-layer-cache"),
      ).toBe(false);
    });
  });
});
