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
  test.each([
    { name: "article leading cd", body: "RUN cd /usr/src/app && git clone example", lines: [2] },
    { name: "standalone cd does not persist", body: "RUN cd /app", lines: [2] },
    { name: "quoted directory", body: 'RUN cd "/app source" && make', lines: [2] },
    { name: "relative directory", body: "RUN cd app && make", lines: [2] },
    { name: "cd with option terminator", body: "RUN cd -- /app && make", lines: [2] },
    { name: "multiline leading cd", body: "RUN cd /app && \\\n    make", lines: [2] },
    {
      name: "multiple RUN offenders aggregate",
      body: "RUN cd /app && make\nRUN cd /other && make",
      lines: [2, 3],
    },
    { name: "WORKDIR already explicit", body: "WORKDIR /app\nRUN make", lines: [] },
    { name: "subshell cd is intentional", body: "RUN (cd /app && make)", lines: [] },
    {
      name: "multiple directory changes",
      body: "RUN cd /app && make && cd /other && make",
      lines: [],
    },
    { name: "non-leading cd", body: "RUN mkdir /app && cd /app && make", lines: [] },
    { name: "conditional cd", body: "RUN if test -d /app; then cd /app && make; fi", lines: [] },
    { name: "semicolon chain", body: "RUN cd /app; make", lines: [] },
    { name: "fallback directory", body: "RUN cd /app || exit 1", lines: [] },
    { name: "dynamic directory", body: 'RUN cd "$APP_DIR" && make', lines: [] },
    { name: "home shorthand", body: "RUN cd ~/app && make", lines: [] },
    { name: "previous directory", body: "RUN cd - && make", lines: [] },
    { name: "quoted command text", body: 'RUN echo "cd /app && make"', lines: [] },
    {
      name: "JSON shell command is excluded",
      body: 'RUN ["sh", "-c", "cd /app && make"]',
      lines: [],
    },
    { name: "heredoc data", body: "RUN cat <<EOF\ncd /app && make\nEOF", lines: [] },
    {
      name: "explicit Bash shell",
      body: 'SHELL ["/bin/bash", "-c"]\nRUN cd /app && make',
      lines: [3],
    },
    {
      name: "non-POSIX shell",
      body: 'SHELL ["powershell", "-command"]\nRUN cd /app && make',
      lines: [],
    },
    {
      name: "stage inherits non-POSIX shell",
      body: 'SHELL ["powershell", "-command"]\nFROM base\nRUN cd /app && make',
      lines: [],
    },
    {
      name: "new base resets shell",
      body: 'SHELL ["powershell", "-command"]\nFROM alpine:3.22\nRUN cd /app && make',
      lines: [4],
    },
  ])("WORKDIR guidance: $name", async ({ body, lines }) => {
    const fixtureRoot = await tempDirs.create("apl-docker-workdir-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      "name: docker\non: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: docker/build-push-action@v6\n        with:\n          context: .\n",
    );
    await writeFile(path.join(fixtureRoot, "Dockerfile"), `FROM alpine:3.22 AS base\n${body}\n`);
    const options = { cwd: fixtureRoot, targetPath: ".", topCount: 100 };
    const report = await analyzeRepository({ ...options, mode: "exploratory" });
    const findings = report.findings.filter(
      (finding) => finding.ruleId === "dockerfile-run-cd-instead-of-workdir",
    );
    expect(findings).toHaveLength(lines.length ? 1 : 0);
    if (lines.length) {
      expect(findings[0]?.severity).toBe("suggestion");
      expect(findings[0]?.location).toEqual({ path: "Dockerfile", line: lines[0], column: 1 });
      expect(findings[0]?.suggestion).toContain("later relative");
    }
    if (body === "RUN cd /usr/src/app && git clone example") {
      const strict = await analyzeRepository({ ...options, mode: "strict" });
      expect(
        strict.findings.some(
          (finding) => finding.ruleId === "dockerfile-run-cd-instead-of-workdir",
        ),
      ).toBe(false);
    }
    if (lines.length > 1) {
      expect(findings[0]?.message).toContain("line 2: /app; line 3: /other");
    }
  });

  test.each([
    {
      name: "comments and blank lines preserve consecutive RUN groups",
      source:
        "FROM alpine:3.22\nrun touch /tmp/download\n# cleanup\n\nRUN rm /tmp/download\nRUN echo done\nENV READY=1\nRUN echo next\nRUN echo last\n",
      mode: "exploratory" as const,
      expected: true,
      groups: "2, 5, 6; 8, 9",
    },
    {
      name: "combined multiline RUN is a single instruction",
      source: "FROM alpine:3.22\nRUN touch /tmp/download && \\\n    rm /tmp/download\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "stage boundaries interrupt RUN groups",
      source: "FROM alpine:3.22 AS build\nRUN echo build\nFROM alpine:3.22\nRUN echo runtime\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "other instructions interrupt RUN groups",
      source:
        "FROM alpine:3.22\nRUN echo first\nWORKDIR /app\nRUN echo second\nCOPY . .\nRUN echo third\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "heredoc contents do not become extra RUN instructions",
      source: "FROM alpine:3.22\nRUN <<EOF\necho first\nRUN echo text\nEOF\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "strict mode omits advisory RUN consolidation",
      source: "FROM alpine:3.22\nRUN echo first\nRUN echo second\n",
      mode: "strict" as const,
      expected: false,
    },
    {
      name: "no RUN instructions",
      source: "FROM alpine:3.22\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "comments before a single RUN",
      source: "FROM alpine:3.22\n# first\n# second\nRUN echo ready\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "two simple RUNs at end of file",
      source: "FROM alpine:3.22\nRUN echo first\nRUN echo second\n",
      mode: "exploratory" as const,
      expected: true,
      groups: "2, 3",
    },
    {
      name: "multiple comments preserve adjacency",
      source:
        "FROM alpine:3.22\nRUN echo first\n# first comment\n# second comment\nRUN echo second\n",
      mode: "exploratory" as const,
      expected: true,
      groups: "2, 5",
    },
    {
      name: "same secret mount flags",
      source:
        "FROM alpine:3.22\nRUN --mount=type=secret,id=foo echo first\nRUN --mount=type=secret,id=foo echo second\n",
      mode: "exploratory" as const,
      expected: true,
      groups: "2, 3",
    },
    {
      name: "secret mount followed by unmounted RUN",
      source: "FROM alpine:3.22\nRUN --mount=type=secret,id=foo echo first\nRUN echo second\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "different secret IDs",
      source:
        "FROM alpine:3.22\nRUN --mount=type=secret,id=foo echo first\nRUN --mount=type=secret,id=bar echo second\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "different network modes",
      source:
        "FROM alpine:3.22\nRUN --network=none echo first\nRUN --network=default echo second\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "different security modes",
      source:
        "FROM alpine:3.22\nRUN --security=sandbox echo first\nRUN --security=insecure echo second\n",
      mode: "exploratory" as const,
      expected: false,
    },
    {
      name: "flag change closes one group and starts another",
      source:
        "FROM alpine:3.22\nRUN --network=none echo first\nRUN --network=none echo second\nRUN --network=default echo third\nRUN --network=default echo fourth\n",
      mode: "exploratory" as const,
      expected: true,
      groups: "2, 3; 4, 5",
    },
    {
      name: "unmounted group after a mounted RUN",
      source:
        "FROM alpine:3.22\nRUN --mount=type=secret,id=foo echo first\nRUN echo second\nRUN echo third\n",
      mode: "exploratory" as const,
      expected: true,
      groups: "3, 4",
      firstLine: 3,
    },
    {
      name: "JSON RUNs remain adjacent instructions",
      source: 'FROM alpine:3.22\nRUN ["echo", "first"]\nRUN ["echo", "second"]\n',
      mode: "exploratory" as const,
      expected: true,
      groups: "2, 3",
    },
  ])("$name", async (scenario) => {
    const { source, mode, expected } = scenario;
    const fixtureRoot = await tempDirs.create("apl-consecutive-run-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "docker.yml"),
      "name: docker\non: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: docker/build-push-action@v6\n        with:\n          context: .\n      - run: docker build .\n",
    );
    await writeFile(path.join(fixtureRoot, "Dockerfile"), source);
    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 100,
      mode,
    });
    const findings = report.findings.filter(
      (finding) => finding.ruleId === "dockerfile-consecutive-run-instructions",
    );
    expect(findings).toHaveLength(expected ? 1 : 0);
    if (expected) {
      expect(findings[0]?.severity).toBe("suggestion");
      expect(findings[0]?.location).toEqual({
        path: "Dockerfile",
        line: ("firstLine" in scenario ? scenario.firstLine : undefined) ?? 2,
        column: 1,
      });
      if ("groups" in scenario) {
        expect(findings[0]?.message).toBe(
          `Dockerfile Dockerfile has consecutive RUN instructions at lines ${scenario.groups}.`,
        );
      }
      expect(findings[0]?.suggestion).toContain("cache reuse");
    }
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
