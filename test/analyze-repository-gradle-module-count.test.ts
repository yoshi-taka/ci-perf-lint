import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const workflow = [
  "name: CI",
  "on: push",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/setup-java@v5",
  "        with: {java-version: 21, distribution: temurin}",
  "      - run: ./gradlew build",
].join("\n");

async function gradleFindingPaths(files: Record<string, string>): Promise<string[]> {
  const cwd = await tempDirs.create("apl-gradle-modules-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": workflow,
    gradlew: "",
    ...files,
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });
  return report.findings
    .filter((finding) => finding.ruleId === "gradle-parallel-not-enabled")
    .map((finding) => finding.location.path);
}

test("buildSrc is not counted as a parallelisable module", async () => {
  const paths = await gradleFindingPaths({
    "buildSrc/build.gradle": "",
    "apps/api/build.gradle": "",
  });
  expect(paths).toEqual([]);
});

test("nested modules are counted without a settings include list", async () => {
  const paths = await gradleFindingPaths({
    "buildSrc/build.gradle": "",
    "apps/api/build.gradle": "",
    "apps/web/build.gradle": "",
  });
  expect(paths).toEqual(["gradle.properties"]);
});

test("settings include entries are counted instead of buildSrc", async () => {
  const paths = await gradleFindingPaths({
    "settings.gradle": 'rootProject.name = "sample"\ninclude(":apps:api")\n',
    "buildSrc/build.gradle": "",
  });
  expect(paths).toEqual([path.posix.join("gradle.properties")]);
});
