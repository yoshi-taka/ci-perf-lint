import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

test("an unreferenced cache stage is reported as unused, not as a cache COPY mismatch", async () => {
  const cwd = await tempDirs.create("apl-docker-unused-stage-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": [
      "name: CI",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: docker build .",
    ].join("\n"),
    Dockerfile: [
      "FROM gradle:8 AS cache",
      "COPY build.gradle.kts .",
      "RUN ./gradlew dependencies",
      "",
      "FROM gradle:8 AS build",
      "COPY build.gradle .",
      "RUN ./gradlew build",
    ].join("\n"),
    "build.gradle": 'plugins { id("java") }\n',
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  expect(
    report.findings.some((finding) => finding.ruleId === "docker-cache-copy-path-mismatch"),
  ).toBe(false);
  const unused = report.findings.find(
    (finding) => finding.ruleId === "dockerfile-unused-build-stage",
  );
  expect(unused).toBeDefined();
  expect(unused?.location.path).toBe("Dockerfile");
  expect(unused?.location.line).toBe(1);
  expect(unused?.message).toContain('"cache"');
  expect(unused?.confidence).toBe("medium");
});

test("unused-stage confidence does not inherit the inferred build context", async () => {
  const cwd = await tempDirs.create("apl-docker-unused-stage-circleci-");
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
    Dockerfile: [
      "FROM gradle:8 AS cache",
      "COPY build.gradle.kts .",
      "RUN ./gradlew dependencies",
      "",
      "FROM gradle:8 AS build",
      "COPY build.gradle .",
      "RUN ./gradlew build",
    ].join("\n"),
    "build.gradle": 'plugins { id("java") }\n',
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  const unused = report.findings.find(
    (finding) => finding.ruleId === "dockerfile-unused-build-stage",
  );
  expect(unused?.confidence).toBe("medium");
});

test("a stage referenced with COPY --from is reachable", async () => {
  const cwd = await tempDirs.create("apl-docker-reachable-stage-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": [
      "name: CI",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: docker build .",
    ].join("\n"),
    Dockerfile: [
      "FROM gradle:8 AS cache",
      "COPY build.gradle.kts .",
      "RUN ./gradlew dependencies",
      "",
      "FROM gradle:8 AS build",
      "COPY --from=cache /root/.gradle /root/.gradle",
      "COPY build.gradle .",
      "RUN ./gradlew build",
    ].join("\n"),
    "build.gradle": 'plugins { id("java") }\n',
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  expect(
    report.findings.some((finding) => finding.ruleId === "dockerfile-unused-build-stage"),
  ).toBe(false);
  expect(
    report.findings.some((finding) => finding.ruleId === "docker-cache-copy-path-mismatch"),
  ).toBe(true);
});
