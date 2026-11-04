import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, assertRuleTestReport, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const versionRule = { id: "prefer-dynamodb-local-3-1", severity: "warning" } as const;
const memoryRule = { id: "consider-dynamodb-local-in-memory", severity: "suggestion" } as const;
const image = "amazon/dynamodb-local";
const latestRun = `docker run --rm -d -p 8000:8000 ${image}:latest -jar DynamoDBLocal.jar -sharedDb`;
const commands: Record<string, string> = {
  old: `docker run --rm ${image}:3.0.0 -jar DynamoDBLocal.jar -sharedDb`,
  old2: `docker run ${image}:2.6.0`,
  latest: latestRun,
  untagged: `docker run --rm ${image} -jar DynamoDBLocal.jar -sharedDb`,
  dockerio: `sudo docker run --rm=true --name db --publish=8000:8000 docker.io/${image}:latest -jar DynamoDBLocal.jar -sharedDb -port 8000 -disableTelemetry`,
  digest: `docker run --rm ${image}@sha256:${"a".repeat(64)} -jar DynamoDBLocal.jar -sharedDb`,
  current: `docker run --rm ${image}:3.1.0 -jar DynamoDBLocal.jar -sharedDb`,
  newer: `docker run ${image}:3.3.2`,
  partial: `docker run ${image}:3.0`,
  prerelease: `docker run ${image}:3.0.0-rc.1`,
  memory: `${latestRun} -inMemory`,
  dbpath: `${latestRun} -dbPath ./data`,
  optimize: `${latestRun} -optimizeDbBeforeStartup`,
  delays: `${latestRun} -delayTransientStatuses`,
  unknownarg: `${latestRun} -unknown`,
  noshared: `docker run --rm ${image}:latest -jar DynamoDBLocal.jar`,
  nojar: `docker run --rm ${image}:latest -sharedDb`,
  nodisposal: `docker run -d ${image}:latest -jar DynamoDBLocal.jar -sharedDb`,
  falseDisposal: `docker run --rm=false ${image}:latest -jar DynamoDBLocal.jar -sharedDb`,
  volume: `docker run --rm -v db:/data ${image}:latest -jar DynamoDBLocal.jar -sharedDb`,
  mount: `docker run --rm --mount=type=tmpfs,destination=/data ${image}:latest -jar DynamoDBLocal.jar -sharedDb`,
  entrypoint: `docker run --rm --entrypoint=java ${image}:latest -jar DynamoDBLocal.jar -sharedDb`,
  unknownDocker: `docker run --rm --unknown ${image}:latest -jar DynamoDBLocal.jar -sharedDb`,
  dynamic: `docker run --rm ${image}:\${VERSION} -jar DynamoDBLocal.jar -sharedDb`,
  mirror: `docker run --rm example.com/${image}:3.0.0 -jar DynamoDBLocal.jar -sharedDb`,
  echo: `echo '${latestRun}'`,
  comment: `# ${latestRun}`,
  heredoc: `cat <<'EOF'\n${latestRun}\nEOF`,
  wrapped: `some-wrapper ${latestRun}`,
  quoted: `docker run --rm '${image}:latest' -jar 'DynamoDBLocal.jar' -sharedDb`,
  continued: `docker run --rm \\\n  ${image}:latest -jar DynamoDBLocal.jar -sharedDb`,
};

function workflow(
  run: string,
  options: { disabledJob?: boolean; disabledStep?: boolean; service?: string } = {},
): string {
  return `name: DynamoDB Local
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    ${options.disabledJob ? "if: false" : "timeout-minutes: 10"}
${options.service ? `    services:\n      db:\n        image: '${options.service}'\n` : ""}    steps:
      - ${options.disabledStep ? "if: false\n        " : ""}run: |
${run
  .split("\n")
  .map((line) => `          ${line}`)
  .join("\n")}
`;
}

describe("DynamoDB Local pinned versions and disposable storage", () => {
  let report: Awaited<ReturnType<typeof analyzeRepositoryForRule>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-dynamodb-local-");
    const dir = path.join(root, ".github/workflows");
    await mkdir(dir, { recursive: true });
    const files = {
      ...Object.fromEntries(Object.entries(commands).map(([name, run]) => [name, workflow(run)])),
      disabledJob: workflow(commands.old!, { disabledJob: true }),
      disabledStep: workflow(commands.old!, { disabledStep: true }),
      serviceOld: workflow("echo test", { service: `${image}:3.0.0` }),
      serviceLatest: workflow("echo test", { service: `${image}:latest` }),
      serviceDigest: workflow("echo test", { service: `${image}:3.0.0@sha256:${"a".repeat(64)}` }),
    };
    await Promise.all(
      Object.entries(files).map(([name, source]) =>
        writeFile(path.join(dir, `${name}.yml`), source),
      ),
    );
    report = await analyzeRepositoryForRule(
      { cwd: root, targetPath: ".", mode: "exploratory", topCount: 500 },
      versionRule,
    );
    assertRuleTestReport(report, memoryRule, "exploratory");
  });
  function findings(name: string, id: string) {
    return report.findings.filter(
      (finding) => finding.ruleId === id && finding.workflow === `.github/workflows/${name}.yml`,
    );
  }
  test.each(["old", "old2", "serviceOld"])("version warning for %s", (name) => {
    const matches = findings(name, versionRule.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.why).toContain("PartiQL");
    expect(matches[0]?.suggestion).toContain("3.1.0");
    expect(matches[0]?.measurementHint).toContain("ordinary DynamoDB");
  });
  test.each([
    "latest",
    "untagged",
    "digest",
    "current",
    "newer",
    "partial",
    "prerelease",
    "serviceLatest",
    "serviceDigest",
    "mirror",
    "dynamic",
    "echo",
    "comment",
    "heredoc",
    "wrapped",
    "disabledJob",
    "disabledStep",
  ])("no old-version inference for %s", (name) => {
    expect(findings(name, versionRule.id)).toHaveLength(0);
  });
  test.each(["old", "latest", "untagged", "dockerio", "digest", "current", "quoted", "continued"])(
    "conditional storage suggestion for %s",
    (name) => {
      const matches = findings(name, memoryRule.id);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.severity).toBe("suggestion");
      expect(matches[0]?.suggestion).toContain("sufficient memory");
      expect(matches[0]?.suggestion).toContain("retaining -sharedDb");
      expect(matches[0]?.why).toContain("restart persistence");
    },
  );
  test.each([
    "old2",
    "memory",
    "dbpath",
    "optimize",
    "delays",
    "unknownarg",
    "noshared",
    "nojar",
    "nodisposal",
    "falseDisposal",
    "volume",
    "mount",
    "entrypoint",
    "unknownDocker",
    "dynamic",
    "mirror",
    "echo",
    "comment",
    "heredoc",
    "wrapped",
    "disabledJob",
    "disabledStep",
    "serviceLatest",
  ])("no storage change recommendation for %s", (name) => {
    expect(findings(name, memoryRule.id)).toHaveLength(0);
  });
  test("suggestion is excluded in strict mode", async () => {
    const root = await tempDirs.create("apl-dynamodb-local-strict-");
    const dir = path.join(root, ".github/workflows");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "ci.yml"), workflow(latestRun));
    const strict = await analyzeRepositoryForRule(
      { cwd: root, targetPath: ".", mode: "strict", topCount: 100 },
      versionRule,
    );
    expect(strict.findings.some((finding) => finding.ruleId === memoryRule.id)).toBe(false);
  });
});
