import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(async () => {
  await tempDirs.cleanup();
});

function workflow(
  ref: string,
  options: {
    on?: string;
    job?: string;
    step?: string;
    inputs?: string;
    command?: string;
    tail?: string;
  } = {},
): string {
  return `name: Gradle CI
on: ${options.on ?? "push"}
jobs:
  build:
    runs-on: ubuntu-latest
${options.job ?? ""}
    steps:
      - uses: gradle/actions/setup-gradle@${ref}
${options.step ?? ""}
${options.inputs ? `        with:\n${options.inputs}` : ""}
${options.command === "" ? "" : `      - run: '${options.command ?? "./gradlew build"}'`}
${options.tail ?? ""}
`;
}

const sha = "a".repeat(40);
const cases: Record<string, string> = {
  old: workflow("v6.1.1"),
  initial: workflow("v6.0.0"),
  minor: workflow("v6.1"),
  sha: workflow(`${sha} # v6.1.1`),
  ratchet: workflow(`${sha} # ratchet:gradle/actions/setup-gradle@v6.1.0`),
  enhanced: workflow("v6.1.0", { inputs: "          cache-provider: enhanced" }),
  "cache-explicit": workflow("v6.1.0", {
    inputs: "          cache-disabled: false\n          cache-read-only: false",
  }),
  "cleanup-always": workflow("v6.1.0", { inputs: "          cache-cleanup: always" }),
  "push-and-pr": workflow("v6.1.0", { on: "[push, pull_request]" }),
  "pr-write-explicit": workflow("v6.1.0", {
    on: "pull_request",
    inputs: "          cache-read-only: false",
  }),
  "pr-write-only": workflow("v6.1.0", {
    on: "pull_request",
    inputs: "          cache-write-only: true",
  }),
  "write-only-mode": workflow("v6.1.0", { job: "    cache-mode: write-only" }),
  windows: workflow("v6.1.0", { command: ".\\gradlew.bat :app:assembleRelease" }),
  "dynamic-flags": workflow("v6.1.0", {
    command: "./gradlew build -Ptoken=${{ secrets.TEST_TOKEN }}",
  }),
  fixed: workflow("v6.2.0"),
  "fixed-minor": workflow("v6.2"),
  newer: workflow("v6.4.0"),
  "fixed-sha": workflow(`${sha} # v6.2.0`),
  floating: workflow("v6"),
  "v5-migration": workflow("v5"),
  "v4-migration": workflow("v4.4.3"),
  branch: workflow("main"),
  unknown: workflow(sha),
  prerelease: workflow("v6.1.0-beta"),
  basic: workflow("v6.1.0", { inputs: "          cache-provider: basic" }),
  external: workflow("v6.1.0", { inputs: "          cache-provider: external" }),
  "dynamic-provider": workflow("v6.1.0", {
    inputs: "          cache-provider: ${{ inputs.provider }}",
  }),
  "cache-disabled": workflow("v6.1.0", { inputs: "          cache-disabled: true" }),
  "cache-dynamic": workflow("v6.1.0", {
    inputs: "          cache-disabled: ${{ inputs.disabled }}",
  }),
  "read-only": workflow("v6.1.0", { inputs: '          cache-read-only: "true"' }),
  "dynamic-read-only": workflow("v6.1.0", {
    inputs: "          cache-read-only: ${{ github.ref != 'refs/heads/main' }}",
  }),
  "cleanup-never": workflow("v6.1.0", { inputs: "          cache-cleanup: never" }),
  "legacy-cleanup-off": workflow("v6.1.0", {
    inputs: "          gradle-home-cache-cleanup: false",
  }),
  "pr-default": workflow("v6.1.0", { on: "pull_request" }),
  "pr-only-job": workflow("v6.1.0", {
    on: "[push, pull_request]",
    job: "    if: github.event_name == 'pull_request'",
  }),
  "cache-off-mode": workflow("v6.1.0", { job: "    cache-mode: none" }),
  "read-mode": workflow("v6.1.0", { job: "    cache-mode: read" }),
  "disabled-step": workflow("v6.1.0", { step: "        if: false" }),
  "disabled-job": workflow("v6.1.0", { job: "    if: false" }),
  "version-only": workflow("v6.1.0", { command: "./gradlew --version" }),
  "no-task-flags": workflow("v6.1.0", { command: "./gradlew -p app -x test --console plain" }),
  "no-gradle": workflow("v6.1.0", { command: "" }),
  echo: workflow("v6.1.0", { command: 'echo "./gradlew build"' }),
  opaque: workflow("v6.1.0", { command: "./scripts/build.sh" }),
  "dynamic-task": workflow("v6.1.0", { command: "./gradlew ${{ inputs.task }}" }),
  multiple: workflow("v6.1.0", {
    tail: "      - uses: gradle/actions/setup-gradle@v6.0.1\n      - run: ./gradlew test",
  }),
};

describe("analyzeRepository: Gradle Action Enhanced cache milestones", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-gradle-action-cache-");
    const directory = path.join(root, ".github", "workflows");
    await mkdir(directory, { recursive: true });
    await Promise.all(
      Object.entries(cases).map(([name, source]) =>
        writeFile(path.join(directory, `${name}.yml`), source),
      ),
    );
    report = await analyzeRepository({ cwd: root, targetPath: ".", mode: "strict", topCount: 200 });
  });
  function findings(name: string) {
    return report.findings.filter(
      (finding) =>
        finding.ruleId === "prefer-setup-gradle-6-2-for-enhanced-cache" &&
        finding.workflow === `.github/workflows/${name}.yml`,
    );
  }
  test.each([
    "old",
    "initial",
    "minor",
    "sha",
    "ratchet",
    "enhanced",
    "cache-explicit",
    "cleanup-always",
    "push-and-pr",
    "pr-write-explicit",
    "pr-write-only",
    "write-only-mode",
    "windows",
    "dynamic-flags",
  ])("flags active Enhanced cache cleanup for %s", (name) => {
    expect(findings(name)).toHaveLength(1);
    expect(findings(name)[0]?.severity).toBe("warning");
    expect(findings(name)[0]?.suggestion).toContain("v6.2.0");
  });
  test.each([
    "fixed",
    "fixed-minor",
    "newer",
    "fixed-sha",
    "floating",
    "v5-migration",
    "v4-migration",
    "branch",
    "unknown",
    "prerelease",
    "basic",
    "external",
    "dynamic-provider",
    "cache-disabled",
    "cache-dynamic",
    "read-only",
    "dynamic-read-only",
    "cleanup-never",
    "legacy-cleanup-off",
    "pr-default",
    "pr-only-job",
    "cache-off-mode",
    "read-mode",
    "disabled-step",
    "disabled-job",
    "version-only",
    "no-task-flags",
    "no-gradle",
    "echo",
    "opaque",
    "dynamic-task",
  ])("does not recommend an unsupported cache change for %s", (name) => {
    expect(findings(name)).toHaveLength(0);
  });
  test("consolidates multiple setup steps per job", () => {
    expect(findings("multiple")).toHaveLength(1);
    expect(findings("multiple")[0]?.message).toContain("v6.0.1");
  });
});
