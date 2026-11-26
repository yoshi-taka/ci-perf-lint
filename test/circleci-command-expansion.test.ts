import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { runCli } from "../src/main.ts";
import { parseCircleCi } from "../src/circleci-workflow.ts";
import { collectCircleCiDockerEvidence } from "../src/circleci-docker-evidence.ts";
import { createLogger, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
const originalFetch = globalThis.fetch;
afterEach(async () => {
  globalThis.fetch = originalFetch;
  await tempDirs.cleanup();
});

function blockNetwork(): void {
  globalThis.fetch = (() => {
    throw new Error("network access is not allowed during lint");
  }) as unknown as typeof fetch;
}

test("local CircleCI commands are expanded for Docker and Gradle rules", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-commands-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "commands:",
      "  build:",
      "    steps:",
      "      - run: docker build --no-cache .",
      "      - run: ./gradlew build",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/openjdk:21}]",
      "    steps:",
      "      - checkout",
      "      - build",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
    "settings.gradle": 'rootProject.name = "sample"\ninclude("lib")\n',
    "build.gradle": 'plugins { id("java") }\n',
    "lib/build.gradle": 'plugins { id("java") }\n',
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  expect(
    report.findings.some(
      (finding) =>
        finding.ruleId === "docker-build-cache-disabled-in-ci" &&
        finding.location.path === ".circleci/config.yml",
    ),
  ).toBe(true);
  expect(
    report.findings.some(
      (finding) =>
        finding.ruleId === "missing-gradle-build-cache" &&
        finding.location.path === ".circleci/config.yml",
    ),
  ).toBe(true);
});

test("a Gradle orb plus Gradle build files is medium-confidence Gradle evidence", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-gradle-orb-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "orbs:",
      "  gradle: circleci/gradle@3.0.0",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/openjdk:21}]",
      "    steps:",
      "      - checkout",
      "      - gradle/test",
      "  test:",
      "    docker: [{image: cimg/openjdk:21}]",
      "    steps:",
      "      - checkout",
      "      - gradle/test",
      "workflows:",
      "  ci:",
      "    jobs: [build, test]",
    ].join("\n"),
    "settings.gradle": 'rootProject.name = "sample"\ninclude("lib")\n',
    "build.gradle": 'plugins { id("java") }\n',
    "lib/build.gradle": 'plugins { id("java") }\n',
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  const gradleCacheFindings = report.findings.filter(
    (finding) => finding.ruleId === "missing-gradle-build-cache",
  );
  expect(gradleCacheFindings).toHaveLength(1);
  expect(gradleCacheFindings[0]?.location.path).toBe(".circleci/config.yml");
  expect(gradleCacheFindings[0]?.message).toContain("CircleCI Gradle orb");
  expect(gradleCacheFindings[0]?.message).toContain("and 1 more");
  expect(gradleCacheFindings[0]?.why).toContain("may already pass `--build-cache`");
  expect(gradleCacheFindings[0]?.why).toContain("gradle.properties");
  const parallel = report.findings.find(
    (finding) => finding.ruleId === "gradle-parallel-not-enabled",
  );
  expect(parallel?.location.path).toBe("gradle.properties");
  expect(parallel?.confidence).toBe("medium");
  expect(parallel?.message).toContain("inferred from CircleCI Gradle orb usage");
  expect(parallel?.why).toContain("may already pass `--parallel`");
  expect(report.analysisWarnings.some((warning) => warning.kind === "orb-unresolved")).toBe(true);
});

test("Gradle orb evidence reads org.gradle.caching and org.gradle.parallel", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-gradle-orb-properties-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "orbs:",
      "  gradle: circleci/gradle@3.0.0",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/openjdk:21}]",
      "    steps:",
      "      - checkout",
      "      - gradle/build_and_test_with_cache",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
    "settings.gradle": 'rootProject.name = "sample"\ninclude("lib")\n',
    "build.gradle": 'plugins { id("java") }\n',
    "lib/build.gradle": 'plugins { id("java") }\n',
    "gradle.properties": "org.gradle.caching=true\norg.gradle.parallel=true\n",
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  expect(report.findings.some((finding) => finding.ruleId === "missing-gradle-build-cache")).toBe(
    false,
  );
  expect(report.findings.some((finding) => finding.ruleId === "gradle-parallel-not-enabled")).toBe(
    false,
  );
});

test("an orb dockerfile parameter is medium-confidence Docker evidence without fetching", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-orb-dockerfile-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "orbs:",
      "  acme: acme/private-orb@1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - checkout",
      "      - acme/build:",
      "          dockerfile: docker/Dockerfile",
      "          path: .",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
    "docker/Dockerfile": [
      "FROM eclipse-temurin:21",
      "COPY build.gradle.kts .",
      "RUN ./gradlew dependencies",
    ].join("\n"),
    "build.gradle": 'plugins { id("java") }\n',
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  const mismatch = report.findings.find(
    (finding) => finding.ruleId === "docker-cache-copy-path-mismatch",
  );
  expect(mismatch?.location.path).toBe("docker/Dockerfile");
  expect(mismatch?.confidence).toBe("medium");
  const warning = report.analysisWarnings.find((entry) => entry.kind === "orb-unresolved");
  expect(warning?.message).toContain("acme/private-orb@1");
  expect(warning?.message).toContain("Docker and Gradle findings may be incomplete");
});

test("an opaque orb plus a repository Dockerfile is medium-confidence evidence", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-orb-dockerfile-exists-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "orbs:",
      "  acme: acme/private-orb@1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - acme/build",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
    Dockerfile: ["FROM ubuntu:latest", "RUN echo build"].join("\n"),
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  const contextFinding = report.findings.find(
    (finding) => finding.ruleId === "missing-dockerignore-for-build-context",
  );
  expect(contextFinding?.location.path).toBe("Dockerfile");
  expect(contextFinding?.confidence).toBe("low");
  expect(
    report.findings.some(
      (finding) =>
        finding.ruleId === "dockerfile-base-image-uses-floating-tag" &&
        finding.location.path === "Dockerfile",
    ),
  ).toBe(true);
});

test("an explicit root Dockerfile restores low-confidence context rules", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-root-dockerfile-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "orbs:",
      "  acme: acme/private-orb@1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - acme/build:",
      "          dockerfile: Dockerfile",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
    Dockerfile: "FROM ubuntu:latest\n",
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  const contextFinding = report.findings.find(
    (finding) => finding.ruleId === "missing-dockerignore-for-build-context",
  );
  expect(contextFinding?.location.path).toBe("Dockerfile");
  expect(contextFinding?.confidence).toBe("low");
});

test("workflow job parameters are expanded in orb dockerfile arguments", () => {
  const source = [
    "version: 2.1",
    "orbs:",
    "  acme: acme/private-orb@1",
    "jobs:",
    "  build:",
    "    parameters:",
    "      path:",
    "        type: string",
    '        default: "."',
    "    docker: [{image: cimg/base:stable}]",
    "    steps:",
    "      - acme/build:",
    "          dockerfile: <<parameters.path>>/Dockerfile",
    "workflows:",
    "  ci:",
    "    jobs:",
    "      - build:",
    '          path: "."',
  ].join("\n");
  const doc = parseCircleCi("/tmp/repo/.circleci/config.yml", "/tmp/repo", source);
  const evidence = collectCircleCiDockerEvidence(doc);
  expect(evidence.some((entry) => entry.dockerfile === "./Dockerfile")).toBe(true);
});

test("setup_remote_docker falls back to repository Dockerfiles without context guesses", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-remote-docker-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - checkout",
      "      - setup_remote_docker",
      "      - run: echo building",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
    Dockerfile: ["FROM ubuntu:latest", "RUN echo build"].join("\n"),
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  const contextFinding = report.findings.find(
    (finding) => finding.ruleId === "missing-dockerignore-for-build-context",
  );
  expect(contextFinding?.location.path).toBe("Dockerfile");
  expect(contextFinding?.confidence).toBe("low");
  expect(
    report.findings.some(
      (finding) =>
        finding.ruleId === "dockerfile-base-image-uses-floating-tag" &&
        finding.location.path === "Dockerfile",
    ),
  ).toBe(true);
});

test("inferred Docker targets skip test and example Dockerfiles", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-inferred-paths-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "orbs:",
      "  acme: acme/private-orb@1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - acme/build",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
    Dockerfile: "FROM ubuntu:latest\n",
    "functional-test/src/test/resources/docker/Dockerfile": "FROM ubuntu:latest\n",
    "examples/Dockerfile": "FROM ubuntu:latest\n",
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  const floatingTagPaths = report.findings
    .filter((finding) => finding.ruleId === "dockerfile-base-image-uses-floating-tag")
    .map((finding) => finding.location.path)
    .sort();
  expect(floatingTagPaths).toEqual(["Dockerfile"]);
});

test("inferred Docker target truncation is reported", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-inferred-limit-");
  const dockerfiles = Object.fromEntries(
    Array.from({ length: 22 }, (_, index) => [`svc${index}/Dockerfile`, "FROM alpine:3.20\n"]),
  );
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "orbs:",
      "  acme: acme/private-orb@1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - acme/build",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
    ...dockerfiles,
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  expect(
    report.analysisWarnings.some(
      (warning) =>
        warning.kind === "scan-warning" &&
        warning.message.includes("limited to 20 files") &&
        warning.message.includes("2 additional Dockerfile candidates"),
    ),
  ).toBe(true);
});

test("CLI prints unresolved orb coverage as a warning", async () => {
  blockNetwork();
  const cwd = await tempDirs.create("apl-circleci-orb-warning-");
  await writeRepositoryFiles(cwd, {
    ".circleci/config.yml": [
      "version: 2.1",
      "orbs:",
      "  acme: acme/private-orb@1",
      "jobs:",
      "  build:",
      "    docker: [{image: cimg/base:stable}]",
      "    steps:",
      "      - acme/build",
      "workflows:",
      "  ci:",
      "    jobs: [build]",
    ].join("\n"),
  });
  const { logger, errors } = createLogger();
  const exitCode = await runCli(["--workflow-only", cwd], cwd, logger);
  expect(exitCode).toBe(0);
  expect(
    errors.some((line) => line.includes("orb reference") && line.includes("acme/private-orb@1")),
  ).toBe(true);
});
