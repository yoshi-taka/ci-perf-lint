import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { dockerBuildWithoutLayerCacheRule } from "../src/rules/docker-build-without-layer-cache.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

const baseOptions = { targetPath: ".", topCount: 20, mode: "strict" as const };

describe("analyzeRepository workflow and execution rules: dockerfile package and cache-mount rules", () => {
  test.each([
    { name: "article pip3 example", body: "RUN pip3 install mysql-connector-python", lines: [2] },
    {
      name: "python module and multiline",
      body: "RUN python3.12 -m pip install \\\n    -r requirements.txt",
      lines: [2],
    },
    { name: "explicit no-cache", body: "RUN pip install --no-cache-dir requests", lines: [] },
    { name: "global no-cache flag", body: "RUN pip --no-cache-dir install requests", lines: [] },
    {
      name: "one safe install does not hide another",
      body: "RUN pip install --no-cache-dir requests && pip3 install flask",
      lines: [2],
    },
    {
      name: "Dockerfile aggregation",
      body: "RUN pip install requests\nRUN python -m pip install flask",
      lines: [2, 3],
    },
    {
      name: "ENV cache suppression",
      body: "ENV PIP_NO_CACHE_DIR=1\nRUN pip install requests",
      lines: [],
    },
    {
      name: "legacy ENV cache suppression",
      body: "ENV PIP_NO_CACHE_DIR true\nRUN pip install requests",
      lines: [],
    },
    {
      name: "pip false spelling also disables cache",
      body: "ENV PIP_NO_CACHE_DIR=false\nRUN pip install requests",
      lines: [],
    },
    {
      name: "command-local suppression",
      body: "RUN env PIP_NO_CACHE_DIR=on pip3 install requests",
      lines: [],
    },
    {
      name: "empty ENV does not disable cache",
      body: 'ENV PIP_NO_CACHE_DIR=""\nRUN pip install requests',
      lines: [3],
    },
    {
      name: "isolated pip ignores suppression ENV",
      body: "ENV PIP_NO_CACHE_DIR=1\nRUN pip --isolated install requests",
      lines: [3],
    },
    {
      name: "new base resets environment",
      body: "ENV PIP_NO_CACHE_DIR=1\nFROM python:3.12-slim\nRUN pip install requests",
      lines: [4],
    },
    {
      name: "named stage inherits environment",
      body: "ENV PIP_NO_CACHE_DIR=1\nFROM base\nRUN pip install requests",
      lines: [],
    },
    {
      name: "default pip cache mount",
      body: "RUN --mount=type=cache,target=/root/.cache/pip pip install requests",
      lines: [],
    },
    {
      name: "parent cache directory mount",
      body: "RUN --mount=type=cache,dst=/root/.cache pip install requests",
      lines: [],
    },
    {
      name: "unrelated cache mount",
      body: "RUN --mount=type=cache,target=/root/.cache/uv pip install requests",
      lines: [2],
    },
    {
      name: "secret mount does not cover pip cache",
      body: "RUN --mount=type=secret,target=/root/.cache/pip pip install requests",
      lines: [2],
    },
    {
      name: "custom ENV cache directory",
      body: "ENV PIP_CACHE_DIR=/cache/pip\nRUN --mount=type=cache,target=/cache/pip pip install requests",
      lines: [],
    },
    {
      name: "custom CLI cache directory",
      body: "RUN --mount=type=cache,target=/cache/pip pip install --cache-dir /cache/pip requests",
      lines: [],
    },
    {
      name: "CLI overrides default mounted directory",
      body: "RUN --mount=type=cache,target=/root/.cache/pip pip install --cache-dir=/cache/pip requests",
      lines: [2],
    },
    {
      name: "CLI cache directory re-enables caching",
      body: "RUN pip install --no-cache-dir --cache-dir=/cache/pip requests",
      lines: [2],
    },
    {
      name: "last no-cache option wins",
      body: "RUN pip install --cache-dir=/cache/pip --no-cache-dir requests",
      lines: [],
    },
    {
      name: "non-root HOME cache mount",
      body: "USER app\nENV HOME=/home/app\nRUN --mount=type=cache,target=/home/app/.cache/pip pip install requests",
      lines: [],
    },
    {
      name: "root mount does not cover non-root cache",
      body: "USER app\nRUN --mount=type=cache,target=/root/.cache/pip pip install requests",
      lines: [3],
    },
    {
      name: "XDG cache mount",
      body: "ENV XDG_CACHE_HOME=/cache\nRUN --mount=type=cache,target=/cache/pip pip install requests",
      lines: [],
    },
    {
      name: "quoted command text and comments",
      body: 'RUN echo "pip install requests" # pip install flask',
      lines: [],
    },
    { name: "JSON RUN", body: 'RUN ["python3", "-m", "pip", "install", "requests"]', lines: [2] },
    { name: "uv pip uses a different cache", body: "RUN uv pip install requests", lines: [] },
    { name: "non-install pip command", body: "RUN pip download requests", lines: [] },
    {
      name: "same-layer cache cleanup",
      body: "RUN pip install requests && rm -rf /root/.cache/pip",
      lines: [],
    },
    {
      name: "later-layer cleanup is ineffective",
      body: "RUN pip install requests\nRUN rm -rf /root/.cache/pip",
      lines: [2],
    },
    {
      name: "install after cleanup recreates cache",
      body: "RUN pip install requests && rm -rf /root/.cache/pip && pip install flask",
      lines: [2],
    },
    {
      name: "unrelated cleanup",
      body: "RUN pip install requests && rm -rf /tmp/downloads",
      lines: [2],
    },
    {
      name: "failure-only cleanup does not cover successful install",
      body: "RUN pip install requests || rm -rf /root/.cache/pip",
      lines: [2],
    },
    { name: "heredoc data", body: "RUN cat <<EOF\npip install requests\nEOF", lines: [] },
  ])("pip cache: $name", async ({ body, lines }) => {
    const fixtureRoot = await tempDirs.create("apl-docker-pip-cache-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      "name: docker\non: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: docker/build-push-action@v6\n        with:\n          context: .\n      - run: docker build .\n",
    );
    await writeFile(
      path.join(fixtureRoot, "Dockerfile"),
      `FROM python:3.12-slim AS base\n${body}\n`,
    );
    const report = await analyzeRepository({ cwd: fixtureRoot, ...baseOptions, topCount: 100 });
    const findings = report.findings.filter(
      (finding) => finding.ruleId === "dockerfile-pip-install-without-no-cache-or-cache-mount",
    );
    expect(findings).toHaveLength(lines.length ? 1 : 0);
    if (lines.length) {
      expect(findings[0]?.severity).toBe("warning");
      expect(findings[0]?.confidence).toBe("medium");
      expect(findings[0]?.location).toEqual({ path: "Dockerfile", line: lines[0], column: 1 });
      expect(findings[0]?.message).toContain(`lines ${lines.join(", ")}.`);
    }
  });

  test("docker-build-without-layer-cache precheck is source-only", () => {
    expect(
      dockerBuildWithoutLayerCacheRule.meta.precheck({ source: "docker/build-push-action@v6" }),
    ).toBe(1);
    expect(dockerBuildWithoutLayerCacheRule.meta.precheck({ source: "echo hello" })).toBe(0);
  });

  test("warns when Rust Dockerfile installs cargo tools without locked resolution and builds release without cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerRustUncachedLike,
      ...baseOptions,
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
    const report = await analyzeRepository({
      cwd: fixtures.dockerMavenUncachedLike,
      ...baseOptions,
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

  test("warns when Gradle Dockerfile resolves dependencies and builds without cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerGradleUncachedLike,
      ...baseOptions,
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

  describe("negative cases: no warning when cache mounts are used", () => {
    const negativeCases = [
      {
        name: "Rust",
        fixture: fixtures.dockerRustCacheOk,
        ruleIds: [
          "dockerfile-cargo-install-without-locked",
          "dockerfile-cargo-build-release-without-cache-mount",
        ] as const,
      },
      {
        name: "Go",
        fixture: fixtures.dockerGoCacheOk,
        ruleIds: [
          "dockerfile-go-mod-download-without-cache-mount",
          "dockerfile-go-build-without-cache-mount",
        ] as const,
      },
      {
        name: "Maven",
        fixture: fixtures.dockerMavenCacheOk,
        ruleIds: [
          "dockerfile-maven-go-offline-without-cache-mount",
          "dockerfile-maven-build-without-cache-mount",
        ] as const,
      },
      {
        name: "Gradle",
        fixture: fixtures.dockerGradleCacheOk,
        ruleIds: [
          "dockerfile-gradle-dependencies-without-cache-mount",
          "dockerfile-gradle-build-without-cache-mount",
        ] as const,
      },
      {
        name: "Ruby",
        fixture: fixtures.dockerRubyCacheOk,
        ruleIds: ["dockerfile-bundle-install-without-cache-mount"] as const,
      },
    ];

    test.each(negativeCases)(
      "does not flag $name Dockerfile when cache mounts are used",
      async ({ fixture, ruleIds }) => {
        const report = await analyzeRepository({ cwd: fixture, ...baseOptions });
        for (const ruleId of ruleIds) {
          expect(report.findings.some((c) => c.ruleId === ruleId)).toBe(false);
        }
      },
    );
  });

  test("warns when Ruby Dockerfile runs bundle install without cache mounts", async () => {
    const report = await analyzeRepository({
      cwd: fixtures.dockerRubyUncachedLike,
      ...baseOptions,
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

  describe("docker/build-push-action layer cache", () => {
    test("warns when docker/build-push-action is used without cache-from and cache-to", async () => {
      const report = await analyzeRepository({
        cwd: fixtures.dockerBuildWithoutLayerCacheLike,
        ...baseOptions,
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

    type NoWarningCase = { name: string; fixture: string };

    const noWarningCases: NoWarningCase[] = [
      {
        name: "does not warn when cache-from and cache-to are set",
        fixture: fixtures.dockerBuildWithoutLayerCacheOk,
      },
      {
        name: "does not warn for depot/build-push-action with cache config",
        fixture: fixtures.dockerBuildWithoutLayerCacheDepotOk,
      },
      {
        name: "does not warn when no-cache: true is set",
        fixture: fixtures.dockerBuildWithoutLayerCacheNocacheOk,
      },
    ];

    test.each(noWarningCases)("$name", async ({ fixture }) => {
      const report = await analyzeRepository({ cwd: fixture, ...baseOptions });
      expect(report.findings.some((c) => c.ruleId === "docker-build-without-layer-cache")).toBe(
        false,
      );
    });
  });
});
