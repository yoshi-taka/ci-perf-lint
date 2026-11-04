import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, assertRuleTestReport, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const versionRule = { id: "prefer-elasticmq-1-3-5", severity: "warning" } as const;
const nativeRule = { id: "prefer-elasticmq-native-image", severity: "warning" } as const;

function workflow(image: string, config = "", disabled = false): string {
  return `name: ElasticMQ
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    ${disabled ? "if: false" : "timeout-minutes: 10"}
    services:
      sqs:
        image: '${image}'
${config}
    steps:
      - run: echo test
`;
}

const cases = [
  ["softwaremill/elasticmq:0.15.8", true, false],
  ["softwaremill/elasticmq:1.3.3", true, false],
  ["softwaremill/elasticmq-native:1.3.4", true, false],
  ["docker.io/softwaremill/elasticmq:1.3.4", true, false],
  ["softwaremill/elasticmq:1.3.5", false, false],
  ["softwaremill/elasticmq:1.3.9", false, false],
  ["softwaremill/elasticmq:1.6.6", false, false],
  ["softwaremill/elasticmq:1.6.7", false, true],
  ["softwaremill/elasticmq:1.6.16", false, true],
  ["docker.io/softwaremill/elasticmq:1.6.16", false, true],
  ["softwaremill/elasticmq:2.0.0", false, true],
  ["softwaremill/elasticmq:latest", false, true],
  ["softwaremill/elasticmq", false, true],
  ["softwaremill/elasticmq-native:1.6.7", false, false],
  ["softwaremill/elasticmq-native:latest", false, false],
  ["softwaremill/elasticmq-native", false, false],
  ["softwaremill/elasticmq:1.6", false, false],
  ["softwaremill/elasticmq:1.3.4-RC9", false, false],
  ["softwaremill/elasticmq:1.6.16-rc.1", false, false],
  [`softwaremill/elasticmq:1.6.16@sha256:${"a".repeat(64)}`, false, false],
  ["example.com/softwaremill/elasticmq:1.3.4", false, false],
  ["softwaremill/elasticmq-ui:1.3.4", false, false],
  ["softwaremill/elasticmq-other:1.3.4", false, false],
  ["softwaremill/elasticmq:${{ matrix.version }}", false, false],
] as const;

describe("ElasticMQ performance guidance", () => {
  let report: Awaited<ReturnType<typeof analyzeRepositoryForRule>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-elasticmq-performance-");
    const dir = path.join(root, ".github/workflows");
    await mkdir(dir, { recursive: true });
    const files = {
      ...Object.fromEntries(cases.map(([image], index) => [`case-${index}`, workflow(image)])),
      disabled: workflow("softwaremill/elasticmq:1.6.16", "", true),
      disabledOld: workflow("softwaremill/elasticmq:1.3.4", "", true),
      env: workflow(
        "softwaremill/elasticmq:1.6.16",
        "        env:\n          JAVA_OPTS: '-Xmx512m'",
      ),
      emptyEnv: workflow("softwaremill/elasticmq:1.6.16", "        env: {}"),
      volumes: workflow(
        "softwaremill/elasticmq:1.6.16",
        "        volumes:\n          - ./elasticmq.conf:/opt/elasticmq.conf",
      ),
      options: workflow("softwaremill/elasticmq:1.6.16", "        options: --memory=512m"),
      ports: workflow("softwaremill/elasticmq:1.6.16", "        ports:\n          - 9324:9324"),
      oldCustomized: workflow(
        "softwaremill/elasticmq:1.3.4",
        "        env:\n          JAVA_OPTS: '-Xmx512m'",
      ),
      comments:
        "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    # image: softwaremill/elasticmq:1.3.4\n    steps:\n      - run: echo softwaremill/elasticmq:1.6.16\n",
    };
    await Promise.all(
      Object.entries(files).map(([name, source]) =>
        writeFile(path.join(dir, `${name}.yml`), source),
      ),
    );
    report = await analyzeRepositoryForRule(
      { cwd: root, targetPath: ".", mode: "strict", topCount: 500 },
      versionRule,
    );
    assertRuleTestReport(report, nativeRule, "strict");
  });
  function findings(name: string, id: string) {
    return report.findings.filter(
      (finding) => finding.ruleId === id && finding.workflow === `.github/workflows/${name}.yml`,
    );
  }
  for (const [index, [image, version, native]] of cases.entries()) {
    test(`${image}: version=${version}, native=${native}`, () => {
      expect(findings(`case-${index}`, versionRule.id)).toHaveLength(version ? 1 : 0);
      expect(findings(`case-${index}`, nativeRule.id)).toHaveLength(native ? 1 : 0);
    });
  }
  test.each(["disabled", "env", "emptyEnv", "volumes", "options", "comments"])(
    "does not blindly switch customized or disabled service %s",
    (name) => {
      expect(findings(name, nativeRule.id)).toHaveLength(0);
    },
  );
  test("preserves version advice for customized old image", () => {
    expect(findings("oldCustomized", versionRule.id)).toHaveLength(1);
    expect(findings("disabledOld", versionRule.id)).toHaveLength(0);
    expect(findings("comments", versionRule.id)).toHaveLength(0);
  });
  test("simple published ports are compatible candidate evidence", () => {
    const matches = findings("ports", nativeRule.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.location.line).toBe(9);
    expect(matches[0]?.suggestion).toContain("own tag or digest");
    expect(matches[0]?.why).toContain("not assumed to improve steady-state");
  });
  test("queue-depth improvement is not described as a startup multiplier", () => {
    const matches = findings("case-1", versionRule.id);
    expect(matches[0]?.why).toContain("complete message-id map");
    expect(matches[0]?.measurementHint).toContain("retained queue depths");
  });
});
