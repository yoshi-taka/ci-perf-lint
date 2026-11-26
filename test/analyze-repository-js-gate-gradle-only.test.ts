import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

test("a Gradle-only repository does not satisfy JavaScript framework gates", async () => {
  const cwd = await tempDirs.create("apl-js-gate-gradle-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": [
      "name: CI",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/setup-java@v5",
      "        with: {java-version: 21, distribution: temurin}",
      "      - run: ./gradlew build",
    ].join("\n"),
    "settings.gradle": 'rootProject.name = "sample"\ninclude("lib")\n',
    "build.gradle": 'plugins { id("java") }\n',
    "lib/build.gradle": 'plugins { id("java") }\n',
    "gradle.properties": "org.gradle.jvmargs=-Xmx2g\n",
  });

  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });

  expect(report.measureCompleteness?.skippedGates).toContain("prefer-jest-30-for-jest-29");
  expect(report.measureCompleteness?.skippedGates).toContain(
    "prefer-nextjs-12-minor-performance-milestone",
  );
});
