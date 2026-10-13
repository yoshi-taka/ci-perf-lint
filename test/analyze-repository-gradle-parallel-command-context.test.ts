import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "gradle-parallel-not-enabled";
const gradleRoot = (root: string) =>
  Object.fromEntries([
    [path.posix.join(root, "settings.gradle"), 'rootProject.name = "sample"\ninclude("lib")\n'],
    [path.posix.join(root, "build.gradle"), 'plugins { id("java") }\n'],
    [path.posix.join(root, "lib/build.gradle"), 'plugins { id("java") }\n'],
  ]);

async function scan(
  jobs: Record<string, unknown>,
  files: Record<string, string> = gradleRoot("."),
  workflow: Record<string, unknown> = {},
) {
  const root = await tempDirs.create("apl-gradle-context-");
  const directory = path.join(root, ".github", "workflows");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "ci.yml"),
    stringify({ name: "JVM CI", on: "push", ...workflow, jobs }),
  );
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    mode: "strict",
    topCount: 100,
  });
  return { findings: report.findings.filter((finding) => finding.ruleId === ruleId), report };
}

const job = (command: string, extra: Record<string, unknown> = {}) => ({
  "runs-on": "ubuntu-latest",
  ...extra,
  steps: [
    { uses: "actions/setup-java@v5", with: { "java-version": "21", distribution: "temurin" } },
    { run: command },
  ],
});

describe("Gradle command and build-root parallel settings", () => {
  test.each([
    ["./gradlew build", true],
    ["./gradlew build && echo --parallel", true],
    ['gradle test --tests "slow --parallel"', true],
    ["gradle build # --parallel", true],
    ["./gradlew :lib:test", true],
    ["gradle --parallel build && gradle test", true],
    ["gradle -- build --parallel", true],
    ["gradle build --parallel", false],
    ["gradle build --no-parallel", false],
    ["gradle build -Dorg.gradle.parallel=false", false],
    ["gradle properties -Pdescription=build", false],
    ["gradle help --task build", false],
    ["gradle build --dry-run", false],
    ["echo './gradlew build'", false],
    ["cat <<EOF\ngradle build\nEOF", false],
  ] as const)("%s", async (command, expected) => {
    const { findings } = await scan({ build: job(command) });
    expect(findings).toHaveLength(expected ? 1 : 0);
  });
  test("a tuned job cannot hide another invocation", async () => {
    const { findings } = await scan({
      tuned: job("gradle build --parallel"),
      untuned: job("gradle test"),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.path).toBe("gradle.properties");
  });
  test.each(["true", "false", "$SETTING"])(
    "explicit root property is respected: %s",
    async (value) => {
      expect(
        (
          await scan(
            { build: job("gradle build") },
            { ...gradleRoot("."), "gradle.properties": `org.gradle.parallel=${value}\n` },
          )
        ).findings,
      ).toEqual([]);
    },
  );
  test("commented properties do not configure parallelism", async () => {
    expect(
      (
        await scan(
          { build: job("gradle build") },
          { ...gradleRoot("."), "gradle.properties": "# org.gradle.parallel=true\n" },
        )
      ).findings,
    ).toHaveLength(1);
  });
  test("project-dir discovers a nested build without a root manifest", async () => {
    const { findings, report } = await scan(
      { build: job("gradle -p java build") },
      gradleRoot("java"),
    );
    expect(
      report.analysisWarnings.some(
        (warning) => warning.kind === "gate-skipped" && warning.source === ruleId,
      ),
    ).toBe(false);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.path).toBe("java/gradle.properties");
  });
  test("independent build roots retain independent command settings", async () => {
    const { findings } = await scan(
      { a: job("gradle -p a build --parallel"), b: job("gradle -p b test") },
      { ...gradleRoot("a"), ...gradleRoot("b") },
    );
    expect(findings.map((finding) => finding.location.path)).toEqual(["b/gradle.properties"]);
  });
  test("unused multi-project roots do not receive findings", async () => {
    const { findings } = await scan(
      { a: job("gradle -p a build --parallel") },
      { ...gradleRoot("a"), ...gradleRoot("b") },
    );
    expect(findings).toEqual([]);
  });
  test("wrapper location does not replace the working directory", async () => {
    const { findings } = await scan(
      { build: job("./java/gradlew build") },
      { ...gradleRoot("java"), "java/gradlew": "" },
    );
    expect(findings).toEqual([]);
  });
  test("nested working directory resolves the parent settings root", async () => {
    const { findings } = await scan(
      { build: job("../gradlew test", { defaults: { run: { "working-directory": "java/lib" } } }) },
      { ...gradleRoot("java"), "java/gradlew": "" },
    );
    expect(findings.map((finding) => finding.location.path)).toEqual(["java/gradle.properties"]);
  });
  test("nested properties do not suppress another build root", async () => {
    const { findings } = await scan(
      { a: job("gradle -p a build"), b: job("gradle -p b build") },
      {
        ...gradleRoot("a"),
        ...gradleRoot("b"),
        "a/gradle.properties": "org.gradle.parallel=true\n",
      },
    );
    expect(findings.map((finding) => finding.location.path)).toEqual(["b/gradle.properties"]);
  });
  test("repository-local user-home properties are respected", async () => {
    const { findings } = await scan(
      { build: job("gradle build -g ci-home") },
      { ...gradleRoot("."), "ci-home/gradle.properties": "org.gradle.parallel=false\n" },
    );
    expect(findings).toEqual([]);
  });
  test("one invocation's user home cannot hide another default invocation", async () => {
    const { findings } = await scan(
      { build: job("gradle build -g ci-home && gradle test") },
      { ...gradleRoot("."), "ci-home/gradle.properties": "org.gradle.parallel=true\n" },
    );
    expect(findings).toHaveLength(1);
  });
  test("step ENV can clear workflow JVM options", async () => {
    const { findings } = await scan(
      {
        build: {
          ...job("gradle build"),
          steps: [{ run: "gradle build", env: { GRADLE_OPTS: "" } }],
        },
      },
      gradleRoot("."),
      { env: { GRADLE_OPTS: "-Dorg.gradle.parallel=true" } },
    );
    expect(findings).toHaveLength(1);
  });
  test("JVM property cannot leak from an unrelated echo", async () => {
    expect(
      (await scan({ build: job("echo GRADLE_OPTS=-Dorg.gradle.parallel=true && gradle build") }))
        .findings,
    ).toHaveLength(1);
  });
});
