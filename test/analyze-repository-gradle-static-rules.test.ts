import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const baseGradle = {
  "settings.gradle": 'rootProject.name = "sample"\ninclude("lib")\n',
  "build.gradle": 'plugins { id("java") }\n',
  "lib/build.gradle": 'plugins { id("java") }\n',
};

async function reportFor(files: Record<string, string>) {
  const cwd = await tempDirs.create("apl-gradle-static-");
  await writeRepositoryFiles(cwd, { ...baseGradle, ...files });
  return analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });
}

test("detects spotlessApply wired into a compile task", async () => {
  const report = await reportFor({
    "build.gradle": 'plugins { id("java") }\ncompileJava.dependsOn "spotlessApply"\n',
  });
  const finding = report.findings.find(
    (candidate) => candidate.ruleId === "gradle-formatter-apply-in-compile",
  );
  expect(finding?.location.path).toBe("build.gradle");
  expect(finding?.confidence).toBe("high");
});

test("spotlessCheck is not reported as a formatter apply hook", async () => {
  const report = await reportFor({
    "build.gradle": 'plugins { id("java") }\ncompileJava.dependsOn "spotlessCheck"\n',
  });
  expect(
    report.findings.some((candidate) => candidate.ruleId === "gradle-formatter-apply-in-compile"),
  ).toBe(false);
});

test("detects mavenLocal without a content filter", async () => {
  const report = await reportFor({
    "settings.gradle":
      'rootProject.name = "sample"\ninclude("lib")\nrepositories { mavenLocal(); mavenCentral() }\n',
  });
  const finding = report.findings.find(
    (candidate) => candidate.ruleId === "gradle-repositories-without-content-filter",
  );
  expect(finding?.location.path).toBe("settings.gradle");
  expect(finding?.confidence).toBe("medium");
});

test("mavenLocal with a content filter is not reported", async () => {
  const report = await reportFor({
    "settings.gradle": [
      'rootProject.name = "sample"',
      'include("lib")',
      "repositories {",
      '  mavenLocal { content { includeGroup "com.example" } }',
      "}",
    ].join("\n"),
  });
  expect(
    report.findings.some(
      (candidate) => candidate.ruleId === "gradle-repositories-without-content-filter",
    ),
  ).toBe(false);
});

test("example Gradle scripts are excluded from static repository rules", async () => {
  const report = await reportFor({
    "examples/demo/build.gradle":
      'plugins { id("java") }\nmavenLocal()\ncompileJava.dependsOn "spotlessApply"\n',
  });
  expect(
    report.findings.some(
      (candidate) =>
        candidate.ruleId === "gradle-repositories-without-content-filter" ||
        candidate.ruleId === "gradle-formatter-apply-in-compile",
    ),
  ).toBe(false);
});

test("referenced CI scripts that invoke Gradle are covered by the repository build-cache fallback", async () => {
  const report = await reportFor({
    ".github/workflows/ci.yml": [
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: bash scripts/ci.sh",
    ].join("\n"),
    "scripts/ci.sh": "./gradlew build\n",
    "gradle.properties": "org.gradle.jvmargs=-Xmx2g\n",
  });
  const finding = report.findings.find(
    (candidate) =>
      candidate.ruleId === "missing-gradle-build-cache" &&
      candidate.location.path === "gradle.properties",
  );
  expect(finding?.message).toContain("referenced CI script");
});

test("org.gradle.caching suppresses the referenced-script fallback", async () => {
  const report = await reportFor({
    ".github/workflows/ci.yml": [
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: bash scripts/ci.sh",
    ].join("\n"),
    "scripts/ci.sh": "./gradlew build\n",
    "gradle.properties": "org.gradle.caching=true\n",
  });
  expect(
    report.findings.some(
      (candidate) =>
        candidate.ruleId === "missing-gradle-build-cache" &&
        candidate.location.path === "gradle.properties",
    ),
  ).toBe(false);
});

test("quoted Gradle text in a non-script command is not treated as hidden Gradle work", async () => {
  const report = await reportFor({
    ".github/workflows/ci.yml": [
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: printf '%s' 'gradle test'",
    ].join("\n"),
  });
  expect(
    report.findings.some(
      (candidate) =>
        candidate.ruleId === "missing-gradle-build-cache" &&
        candidate.location.path === "gradle.properties",
    ),
  ).toBe(false);
});
