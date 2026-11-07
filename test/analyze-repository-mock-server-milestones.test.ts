import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, assertRuleTestReport, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const milestones = [
  {
    id: "prefer-wiremock-3-11",
    image: "wiremock/wiremock",
    old: "3.10.0",
    target: "3.11.0",
    future: "4.0.0",
    why: "XSLT",
  },
  {
    id: "prefer-mockserver-9-1",
    image: "mockserver/mockserver",
    old: "9.0.0",
    target: "9.1.0",
    future: "10.0.0",
    why: "event-log",
  },
] as const;

function workflow(image: string, extra = "", moreServices = ""): string {
  return `name: HTTP mock
on: push
jobs:
  integration:
    runs-on: ubuntu-latest
    ${extra || "timeout-minutes: 10"}
    services:
      mock:
        image: '${image}'
${moreServices}
    steps:
      - run: echo test
`;
}

function runWorkflow(image: string): string {
  return `name: HTTP mock run
on: push
jobs:
  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: docker run -d --rm -p 8080:8080 ${image}
`;
}

describe("HTTP mock server performance milestones", () => {
  let report: Awaited<ReturnType<typeof analyzeRepositoryForRule>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-http-mock-milestones-");
    const dir = path.join(root, ".github/workflows");
    await mkdir(dir, { recursive: true });
    const files: Record<string, string> = {};
    for (const config of milestones) {
      const refs = {
        old: `${config.image}:${config.old}`,
        revision: `${config.image}:${config.old}-1`,
        major: `${config.image}:2.0.0`,
        dockerio: `docker.io/${config.image}:${config.old}`,
        target: `${config.image}:${config.target}`,
        future: `${config.image}:${config.future}`,
        latest: `${config.image}:latest`,
        partial: `${config.image}:3.0`,
        prerelease: `${config.image}:${config.old}-rc.1`,
        digest: `${config.image}:${config.old}@sha256:${"a".repeat(64)}`,
        mirror: `example.com/${config.image}:${config.old}`,
        lookalike: `${config.image}-other:${config.old}`,
        expression: `${config.image}:\${{ matrix.version }}`,
        variant: `${config.image}:${config.old}-alpine`,
      };
      for (const [name, image] of Object.entries(refs)) {
        files[`${config.id}-${name}`] = workflow(image);
      }
      files[`${config.id}-docker-run-old`] = runWorkflow(refs.old);
      files[`${config.id}-docker-run-wrapped`] = runWorkflow(refs.old).replace(
        "run: docker",
        "run: nohup docker",
      );
      files[`${config.id}-docker-run-revision`] = runWorkflow(refs.revision);
      files[`${config.id}-docker-run-target`] = runWorkflow(refs.target);
      files[`${config.id}-docker-run-latest`] = runWorkflow(refs.latest);
      files[`${config.id}-docker-run-expression`] = runWorkflow(refs.expression);
      files[`${config.id}-disabled`] = workflow(refs.old, "if: false");
      files[`${config.id}-disabled-string`] = workflow(refs.old, "if: 'false'");
      files[`${config.id}-multiple`] = workflow(
        refs.old,
        "",
        `      other:\n        image: ${refs.old}`,
      );
    }
    files.comments =
      "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    # image: wiremock/wiremock:3.10.0\n    steps:\n      - run: echo mockserver/mockserver:5.15.0\n";
    await Promise.all(
      Object.entries(files).map(([name, source]) =>
        writeFile(path.join(dir, `${name}.yml`), source),
      ),
    );
    report = await analyzeRepositoryForRule(
      { cwd: root, targetPath: ".", mode: "strict", topCount: 500 },
      { id: milestones[0].id, severity: "warning" },
    );
    assertRuleTestReport(report, { id: milestones[1].id, severity: "warning" }, "strict");
  });
  function findings(name: string, id: string) {
    return report.findings.filter(
      (finding) => finding.ruleId === id && finding.workflow === `.github/workflows/${name}.yml`,
    );
  }
  for (const config of milestones) {
    for (const name of ["old", "revision", "major", "dockerio"]) {
      test(`${config.id}: warns for ${name}`, () => {
        const matches = findings(`${config.id}-${name}`, config.id);
        expect(matches).toHaveLength(1);
        expect(matches[0]?.severity).toBe("warning");
        expect(matches[0]?.suggestion).toContain(config.target);
        expect(matches[0]?.why).toContain(config.why);
        expect(matches[0]?.location.line).toBe(9);
        expect(matches[0]?.measurementHint).toContain("assertions unchanged");
      });
    }
    for (const name of [
      "target",
      "future",
      "latest",
      "partial",
      "prerelease",
      "digest",
      "mirror",
      "lookalike",
      "expression",
      "variant",
      "disabled",
      "disabled-string",
    ]) {
      test(`${config.id}: skips ${name}`, () => {
        expect(findings(`${config.id}-${name}`, config.id)).toHaveLength(0);
      });
    }
    test(`${config.id}: locations for separate services`, () => {
      const matches = findings(`${config.id}-multiple`, config.id);
      expect(matches).toHaveLength(2);
      expect(matches.map((finding) => finding.location.line).sort((a, b) => a - b)).toEqual([
        9, 11,
      ]);
    });
    test.each(["docker-run-old", "docker-run-wrapped", "docker-run-revision"])(
      `${config.id}: warns for %s`,
      (name) => {
        const matches = findings(`${config.id}-${name}`, config.id);
        expect(matches).toHaveLength(1);
        expect(matches[0]?.message).toContain("runs");
      },
    );
    test.each(["docker-run-target", "docker-run-latest", "docker-run-expression"])(
      `${config.id}: skips %s`,
      (name) => {
        expect(findings(`${config.id}-${name}`, config.id)).toHaveLength(0);
      },
    );
    test(`${config.id}: does not scan comments or arbitrary step text`, () => {
      expect(findings("comments", config.id)).toHaveLength(0);
    });
  }
});
