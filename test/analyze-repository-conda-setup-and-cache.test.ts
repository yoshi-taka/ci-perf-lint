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
    runner?: string;
    job?: string;
    step?: string;
    inputs?: string;
    tail?: string;
  } = {},
): string {
  return `name: Conda CI
on: push
jobs:
  test:
    runs-on: ${options.runner ?? "ubuntu-latest"}
${options.job ?? ""}
    steps:
      - uses: conda-incubator/setup-miniconda@${ref}
${options.step ?? ""}
        with:
          python-version: '3.12'
          activate-environment: test
${options.inputs ?? ""}
      - run: conda info
        shell: bash -l {0}
${options.tail ?? ""}
`;
}

const sha = "a".repeat(40);
const cases: Record<string, string> = {
  v3: workflow("v3"),
  v2: workflow("v2"),
  v1: workflow("v1"),
  minor: workflow("v3.3"),
  patch: workflow("v3.3.0"),
  windows: workflow("v3", { runner: "windows-2022" }),
  macos: workflow("v3", { runner: "macos-latest" }),
  "sha-major": workflow(`${sha} # v3`),
  "sha-patch": workflow(`${sha} # v3.3.0`),
  ratchet: workflow(`${sha} # ratchet:conda-incubator/setup-miniconda@v3`),
  "sha-action-version": workflow(`${sha} # conda-incubator/setup-miniconda@v3.3.0`),
  miniforge: workflow("v3", {
    inputs: "          miniforge-version: latest\n          use-mamba: true",
  }),
  "custom-installer": workflow("v3", {
    inputs: "          installer-url: https://example.com/installer.sh",
  }),
  "post-disabled": workflow("v3", { inputs: "          run-post: false" }),
  "cache-disabled": workflow("v3", { job: "    cache-mode: none" }),
  matrix: workflow("v3", {
    runner: "${{ matrix.os }}",
    job: "    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest, macos-latest]",
  }),
  v4: workflow("v4"),
  "v4-minor": workflow("v4.1"),
  "v4-patch": workflow("v4.0.0"),
  "v4-sha": workflow(`${sha} # v4.0.0`),
  future: workflow("v5"),
  branch: workflow("main"),
  prerelease: workflow("v4.0.0-beta"),
  dynamic: workflow("${{ inputs.action_ref }}"),
  "unknown-sha": workflow(sha),
  "other-comment": workflow(`${sha} # actions/setup-python@v3`),
  "branch-comment": workflow("main # v3"),
  "disabled-job": workflow("v3", { job: "    if: false" }),
  "disabled-step": workflow("v3", { step: '        if: "false"' }),
  micromamba: workflow("v3").replace(
    "conda-incubator/setup-miniconda@",
    "mamba-org/setup-micromamba@",
  ),
  multiple: workflow("v3", {
    tail: "      - name: Second conda environment\n        uses: conda-incubator/setup-miniconda@v2\n        with:\n          activate-environment: alternate",
  }),
};

describe("analyzeRepository: Conda setup and cache milestones", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-conda-setup-");
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
        finding.ruleId === "prefer-setup-miniconda-v4" &&
        finding.workflow === `.github/workflows/${name}.yml`,
    );
  }
  test.each([
    "v3",
    "v2",
    "v1",
    "minor",
    "patch",
    "windows",
    "macos",
    "sha-major",
    "sha-patch",
    "ratchet",
    "sha-action-version",
    "miniforge",
    "custom-installer",
    "post-disabled",
    "cache-disabled",
    "matrix",
  ])("flags old setup-miniconda %s", (name) => {
    expect(findings(name)).toHaveLength(1);
    expect(findings(name)[0]?.severity).toBe("warning");
    expect(findings(name)[0]?.suggestion).toContain("to v4");
    expect(findings(name)[0]?.why).toContain("subprocesses");
  });
  test.each([
    "v4",
    "v4-minor",
    "v4-patch",
    "v4-sha",
    "future",
    "branch",
    "prerelease",
    "dynamic",
    "unknown-sha",
    "other-comment",
    "branch-comment",
    "disabled-job",
    "disabled-step",
    "micromamba",
  ])("does not flag current or unclassified setup %s", (name) => {
    expect(findings(name)).toHaveLength(0);
  });
  test("consolidates multiple Conda environments per job", () => {
    expect(findings("multiple")).toHaveLength(1);
    expect(findings("multiple")[0]?.message).toContain("conda-incubator/setup-miniconda@v3");
    expect(findings("multiple")[0]?.message).toContain("conda-incubator/setup-miniconda@v2");
  });
});
