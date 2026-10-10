import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(async () => {
  await tempDirs.cleanup();
});

function workflow(ref: string, extra = "", step = "", tail = ""): string {
  return `name: Java CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
${extra}
    steps:
      - uses: actions/setup-java@${ref}
${step}
        with:
          java-version: 21
          distribution: temurin
          cache: maven
      - run: ./mvnw test
${tail}
`;
}

const sha = "a".repeat(40);
const cases: Record<string, string> = {
  v5: workflow("v5"),
  v4: workflow("v4.7.1"),
  v1: workflow("v1"),
  minor: workflow("v5.7"),
  patch: workflow("v5.7.0"),
  "sha-major": workflow(`${sha} # v5`),
  "sha-patch": workflow(`${sha} # v5.7.0`),
  ratchet: workflow(`${sha} # ratchet:actions/setup-java@v5`),
  "sha-action-version": workflow(`${sha} # actions/setup-java@v5.7.0`),
  "no-dependency-cache": workflow("v5").replace("          cache: maven\n", ""),
  "cache-disabled": workflow("v5", "    cache-mode: none"),
  v6: workflow("v6"),
  "v6-patch": workflow("v6.0.0"),
  "v6-sha": workflow(`${sha} # v6.0.0`),
  future: workflow("v7"),
  branch: workflow("main"),
  prerelease: workflow("v6.0.0-beta"),
  dynamic: workflow("${{ inputs.action_ref }}"),
  "unknown-sha": workflow(sha),
  "other-comment": workflow(`${sha} # actions/checkout@v5`),
  "branch-comment": workflow("main # v5"),
  "disabled-job": workflow("v5", "    if: false"),
  "disabled-step": workflow("v5", "", "        if: false"),
  "other-action": workflow("v5").replace("actions/setup-java@", "actions/setup-node@"),
  multiple: workflow(
    "v5",
    "",
    "",
    `      - uses: actions/setup-java@v4
        with:
          java-version: 17
          distribution: temurin`,
  ),
};

describe("analyzeRepository: Java setup and cache milestones", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-java-setup-");
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
        finding.ruleId === "prefer-setup-java-v6" &&
        finding.workflow === `.github/workflows/${name}.yml`,
    );
  }

  test.each([
    "v5",
    "v4",
    "v1",
    "minor",
    "patch",
    "sha-major",
    "sha-patch",
    "ratchet",
    "sha-action-version",
    "no-dependency-cache",
    "cache-disabled",
  ])("flags old setup-java %s", (name) => {
    expect(findings(name)).toHaveLength(1);
    expect(findings(name)[0]?.severity).toBe("warning");
    expect(findings(name)[0]?.suggestion).toContain("to v6");
    expect(findings(name)[0]?.why).toContain("parallel");
  });
  test.each([
    "v6",
    "v6-patch",
    "v6-sha",
    "future",
    "branch",
    "prerelease",
    "dynamic",
    "unknown-sha",
    "other-comment",
    "branch-comment",
    "disabled-job",
    "disabled-step",
    "other-action",
  ])("does not flag current or unclassified setup %s", (name) => {
    expect(findings(name)).toHaveLength(0);
  });
  test("consolidates multiple JDK setups per job", () => {
    expect(findings("multiple")).toHaveLength(1);
    expect(findings("multiple")[0]?.message).toContain("actions/setup-java@v5");
    expect(findings("multiple")[0]?.message).toContain("actions/setup-java@v4");
  });
});
