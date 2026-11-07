import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "prefer-localstack-performance-milestone", severity: "warning" } as const;
const cases = [
  ["1.1.0", "", "2.0"],
  ["2.0.0", "s3", "3.0"],
  ["2.3.0", "dynamodb", "3.0"],
  ["3.0.0", "events", "4.1"],
  ["4.0.0", "events", "4.1"],
  ["3.9.0", "appsync", "4.6"],
  ["4.5.9", "appsync", "4.6"],
  ["4.6.0", "appsync", undefined],
  ["4.14.0", "appsync", undefined],
  ["4.1.0", "events", undefined],
  ["3.0.0", "s3,dynamodb", undefined],
  ["2.0.0", "sqs", undefined],
  ["2.0.0", "", undefined],
  ["latest", "appsync", undefined],
  ["4", "appsync", undefined],
  ["4.5", "appsync", undefined],
  ["4.6.0-rc.1", "appsync", undefined],
  ["2026.03.0", "appsync", undefined],
  ["5.0.0", "appsync", undefined],
  ["${{ matrix.version }}", "appsync", undefined],
  ["4.5.0@sha256:abc", "appsync", undefined],
] as const;

function workflow(image: string, services: string, disabled = false): string {
  return `name: localstack
on: push
jobs:
  integration:
    runs-on: ubuntu-latest
    ${disabled ? "if: false" : "timeout-minutes: 10"}
    services:
      aws:
        image: '${image}'
        env:
          SERVICES: '${services}'
    steps:
      - run: echo test
`;
}

function runWorkflow(image: string, services: string): string {
  return `name: localstack run
on: push
jobs:
  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: docker run -d --rm -e SERVICES=${services} -p 4566:4566 ${image}
`;
}

describe("LocalStack runtime performance milestones", () => {
  let report: Awaited<ReturnType<typeof analyzeRepositoryForRule>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-localstack-");
    const dir = path.join(root, ".github/workflows");
    await mkdir(dir, { recursive: true });
    await Promise.all(
      cases.map(([version, services], index) =>
        writeFile(
          path.join(dir, `case-${index}.yml`),
          workflow(`localstack/localstack:${version}`, services),
        ),
      ),
    );
    await writeFile(
      path.join(dir, "pro.yml"),
      workflow("docker.io/localstack/localstack-pro:4.5.0", " appsync "),
    );
    await writeFile(
      path.join(dir, "disabled.yml"),
      workflow("localstack/localstack:1.1.0", "", true),
    );
    await writeFile(
      path.join(dir, "mirror.yml"),
      workflow("example.com/localstack/localstack:1.1.0", ""),
    );
    await writeFile(
      path.join(dir, "run-1.1.yml"),
      runWorkflow("localstack/localstack:1.1.0", "sqs"),
    );
    await writeFile(
      path.join(dir, "run-2.0-s3.yml"),
      runWorkflow("localstack/localstack:2.0.0", "s3"),
    );
    await writeFile(
      path.join(dir, "run-4.5-appsync.yml"),
      runWorkflow("localstack/localstack:4.5.9", "appsync"),
    );
    await writeFile(
      path.join(dir, "run-4.6-appsync.yml"),
      runWorkflow("localstack/localstack:4.6.0", "appsync"),
    );
    report = await analyzeRepositoryForRule(
      { cwd: root, targetPath: ".", mode: "strict", topCount: 500 },
      rule,
    );
  });

  for (const [index, [version, services, target]] of cases.entries()) {
    test(`${version} with SERVICES=${services}: ${target ?? "skip"}`, () => {
      const matches = report.findings.filter(
        (finding) =>
          finding.ruleId === rule.id && finding.workflow === `.github/workflows/case-${index}.yml`,
      );
      expect(matches).toHaveLength(target ? 1 : 0);
      if (target) {
        expect(matches[0]?.severity).toBe("warning");
        expect(matches[0]?.message).toContain(`LocalStack ${target}`);
        expect(matches[0]?.suggestion).toContain("4.x ceiling");
        expect(matches[0]?.location.line).toBe(9);
      }
    });
  }
  test("supports Pro and docker.io without confusing mirrors or disabled jobs", () => {
    const files = report.findings
      .filter((finding) => finding.ruleId === rule.id)
      .map((finding) => finding.workflow);
    expect(files).toContain(".github/workflows/pro.yml");
    expect(files).not.toContain(".github/workflows/disabled.yml");
    expect(files).not.toContain(".github/workflows/mirror.yml");
  });
  test.each([
    ["run-1.1", "2.0"],
    ["run-2.0-s3", "3.0"],
    ["run-4.5-appsync", "4.6"],
  ])("warns for docker run %s", (name, target) => {
    const matches = report.findings.filter(
      (finding) =>
        finding.ruleId === rule.id && finding.workflow === `.github/workflows/${name}.yml`,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain(`LocalStack ${target}`);
    expect(matches[0]?.message).toContain("runs");
  });
  test("skips a docker run already on the milestone", () => {
    const matches = report.findings.filter(
      (finding) =>
        finding.ruleId === rule.id && finding.workflow === ".github/workflows/run-4.6-appsync.yml",
    );
    expect(matches).toHaveLength(0);
  });
});
