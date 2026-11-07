import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "prefer-localstack-alternatives", severity: "warning" } as const;
const digest = `sha256:${"a".repeat(64)}`;
const positive = [
  "localstack/localstack",
  "localstack/localstack:2.0.0",
  "localstack/localstack:3.0.0",
  "localstack/localstack:4.14.0",
  "localstack/localstack:2026.10.0",
  "localstack/localstack:latest",
  "docker.io/localstack/localstack:stable",
  "localstack/localstack-pro:4.6.0",
  "docker.io/localstack/localstack-pro:2026.10.0",
  "localstack/localstack:4.6.0-rc.1",
  `localstack/localstack@${digest}`,
  `localstack/localstack:4.14.0@${digest}`,
];
const negative = [
  "floci/floci:2.2.0",
  "ministackorg/ministack:latest",
  "faiscadev/fakecloud:latest",
  "motoserver/moto:5.1.22",
  "example.com/localstack/localstack:4.14.0",
  "localstack/localstack-other:4.14.0",
  "localstack/localstack-proxy",
  "other/localstack:4.14.0",
  "${{ matrix.image }}",
  "localstack/localstack:${{ matrix.version }}",
  "localstack/localstack@sha256:invalid",
];

function workflow(image: string, extraJob = "", secondService = ""): string {
  return `name: local AWS
on: push
jobs:
  integration:
    runs-on: ubuntu-latest
${extraJob}
    services:
      aws:
        image: '${image}'
${secondService}
    steps:
      - run: echo test
`;
}

function runWorkflow(image: string): string {
  return `name: local AWS run
on: push
jobs:
  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: docker run -d --rm -p 4566:4566 ${image}
`;
}

describe("LocalStack emulator alternatives", () => {
  let report: Awaited<ReturnType<typeof analyzeRepositoryForRule>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-localstack-alternatives-");
    const dir = path.join(root, ".github/workflows");
    await mkdir(dir, { recursive: true });
    const cases = {
      ...Object.fromEntries(positive.map((image, i) => [`positive-${i}`, workflow(image)])),
      ...Object.fromEntries(negative.map((image, i) => [`negative-${i}`, workflow(image)])),
      disabled: workflow(positive[0]!, "    if: false"),
      "disabled-string": workflow(positive[0]!, "    if: 'false'"),
      multiple: workflow(
        positive[0]!,
        "",
        "      legacy:\n        image: localstack/localstack:1.1.0",
      ),
      "separate-jobs": `${workflow(positive[0]!)}  other:\n    runs-on: ubuntu-latest\n    services:\n      aws:\n        image: localstack/localstack-pro:4.14.0\n    steps:\n      - run: echo test\n`,
      "comment-only":
        "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    # image: localstack/localstack:4.14.0\n    steps:\n      - run: echo localstack/localstack:4.14.0\n",
      coexist: workflow("localstack/localstack:1.1.0"),
      "docker-run-positive": runWorkflow("localstack/localstack:2.0.0"),
      "docker-run-negative": runWorkflow("example.com/localstack/localstack:2.0.0"),
    };
    await Promise.all(
      Object.entries(cases).map(([name, source]) =>
        writeFile(path.join(dir, `${name}.yml`), source),
      ),
    );
    report = await analyzeRepositoryForRule(
      { cwd: root, targetPath: ".", mode: "strict", topCount: 500 },
      rule,
    );
  });

  function findings(name: string) {
    return report.findings.filter(
      (finding) =>
        finding.ruleId === rule.id && finding.workflow === `.github/workflows/${name}.yml`,
    );
  }
  for (const [index, image] of positive.entries()) {
    test(`warns for ${image}`, () => {
      const matches = findings(`positive-${index}`);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.severity).toBe("warning");
      expect(matches[0]?.message).toContain(image);
      expect(matches[0]?.location.line).toBe(9);
      for (const name of ["Floci", "MiniStack", "fakecloud"]) {
        expect(matches[0]?.suggestion).toContain(name);
      }
      expect(matches[0]?.suggestion).not.toContain("Moto");
      expect(matches[0]?.suggestion).toContain("AGPL-3.0");
    });
  }
  for (const [index, image] of negative.entries()) {
    test(`does not warn for ${image}`, () => {
      expect(findings(`negative-${index}`)).toHaveLength(0);
    });
  }
  test("skips disabled jobs and non-image text", () => {
    for (const name of ["disabled", "disabled-string", "comment-only"]) {
      expect(findings(name)).toHaveLength(0);
    }
  });
  test("deduplicates within jobs, not across jobs", () => {
    expect(findings("multiple")).toHaveLength(1);
    expect(findings("separate-jobs")).toHaveLength(2);
  });
  test("does not suppress the independent LocalStack milestone rule", () => {
    expect(findings("coexist")).toHaveLength(1);
    expect(
      report.findings.some(
        (finding) =>
          finding.workflow === ".github/workflows/coexist.yml" &&
          finding.ruleId === "prefer-localstack-performance-milestone",
      ),
    ).toBe(true);
  });
  test("warns for docker run and ignores mirrors", () => {
    const matches = findings("docker-run-positive");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain("docker run");
    expect(findings("docker-run-negative")).toHaveLength(0);
  });
});
