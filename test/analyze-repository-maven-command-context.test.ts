import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "maven-parallel-not-enabled";
const job = (run: string, extra: Record<string, unknown> = {}) => ({
  "runs-on": "ubuntu-latest",
  ...extra,
  steps: [{ run }],
});
async function scan(
  jobs: Record<string, unknown>,
  files: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) {
  const cwd = await tempDirs.create("apl-maven-context-");
  await writeRepositoryFiles(cwd, {
    "pom.xml": "<project><modules><module>app</module></modules></project>",
    ".github/workflows/ci.yml": stringify({ on: "push", ...extra, jobs }),
    ...files,
  });
  const report = await analyzeRepository({ cwd, targetPath: ".", topCount: 1000, mode: "strict" });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test.each([
  ["mvn verify", true],
  ["echo 'mvn verify'", false],
  ["mvn verify && echo -T2", true],
  ['mvn verify -Dmessage="value -T2"', true],
  ['mvn verify --settings "directory --threads=2"', true],
  ["mvn help:evaluate -Dexpression=project.verify", false],
  ["mvn help:evaluate --define verify", false],
  ["mvn -T=2 verify", false],
  ["mvn --threads 0.5C verify", false],
  ["mvn -T2 verify && mvn test", true],
  ["mvn -V verify", true],
  ["mvn verify --version", false],
  ["cat <<EOF\nmvn verify\nEOF", false],
  ["MAVEN_ARGS=-T2 mvn verify", false],
  ["MAVEN_ARGS=-T2 mvn verify && mvn test", true],
] as const)("repository Maven command ownership: %s", async (command, expected) => {
  expect(await scan({ build: job(command) })).toHaveLength(expected ? 1 : 0);
});

test.each([
  ['-Dmessage="value -T2"', true],
  ['--settings "directory --threads=2"', true],
  ["# -T2\n", true],
  ["--threads\n1C\n", false],
  ["-T=2\n", false],
  ["--threads=$WORKERS", false],
] as const)("config must contain a real thread setting: %s", async (config, expected) => {
  expect(await scan({ build: job("mvn verify") }, { ".mvn/maven.config": config })).toHaveLength(
    expected ? 1 : 0,
  );
});

test("workflow MAVEN_ARGS is considered", async () => {
  expect(
    await scan({ build: job("mvn verify") }, {}, { env: { MAVEN_ARGS: "--threads 1C" } }),
  ).toEqual([]);
});

test("step ENV can clear inherited Maven thread options", async () => {
  expect(
    await scan(
      { build: { ...job("mvn verify"), steps: [{ run: "mvn verify", env: { MAVEN_ARGS: "" } }] } },
      {},
      { env: { MAVEN_ARGS: "-T2" } },
    ),
  ).toHaveLength(1);
});

test("Maven JVM options are not thread options", async () => {
  expect(
    await scan({ build: job("mvn verify", { env: { MAVEN_OPTS: "-Dmessage=-T2" } }) }),
  ).toHaveLength(1);
});

test("one job's Maven ENV cannot tune another job", async () => {
  expect(
    await scan({
      tuned: job("mvn verify", { env: { MAVEN_ARGS: "-T2" } }),
      untuned: job("mvn test"),
    }),
  ).toHaveLength(1);
});
