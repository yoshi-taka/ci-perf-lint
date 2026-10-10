import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(async () => {
  await tempDirs.cleanup();
});

const ccache = "hendrikmuhs/ccache-action";
const rust = "Swatinem/rust-cache";
const sha = "a".repeat(40);
const ccacheRule = "prefer-ccache-action-1-2-20-on-windows";
const rustRule = "prefer-rust-cache-2-9-2";

function workflow(
  action: string,
  ref: string,
  options: {
    runner?: string;
    job?: string;
    step?: string;
    config?: string;
    after?: string;
  } = {},
): string {
  return `name: Compilation
on: push
jobs:
  build:
    runs-on: ${options.runner ?? "windows-2022"}
${options.job ?? ""}
    steps:
      - uses: ${action}@${ref}
${options.step ?? ""}
${options.config ? `        with:\n${options.config}` : ""}
${options.after ?? ""}
`;
}

const cases: Record<string, string> = {
  "ccache-old": workflow(ccache, "v1.2.19"),
  "ccache-older": workflow(ccache, "v1.1.0"),
  "ccache-fixed": workflow(ccache, "v1.2.20"),
  "ccache-newer": workflow(ccache, "v1.2.24"),
  "ccache-linux": workflow(ccache, "v1.2.19", { runner: "ubuntu-latest" }),
  "ccache-macos": workflow(ccache, "v1.2.19", { runner: "macos-latest" }),
  "ccache-sccache": workflow(ccache, "v1.2.19", { config: "          variant: sccache" }),
  "ccache-dynamic-variant": workflow(ccache, "v1.2.19", {
    config: "          variant: ${{ matrix.variant }}",
  }),
  "ccache-floating": workflow(ccache, "v1.2"),
  "ccache-sha": workflow(ccache, `${sha} # v1.2.19`),
  "ccache-ratchet": workflow(ccache, `${sha} # ratchet:hendrikmuhs/ccache-action@v1.2.19`),
  "ccache-unknown-sha": workflow(ccache, sha),
  "ccache-other-comment": workflow(ccache, `${sha} # actions/checkout@v1.2.19`),
  "ccache-main-comment": workflow(ccache, "main # v1.2.19"),
  "ccache-prerelease": workflow(ccache, "v1.2.20-beta"),
  "ccache-self-hosted": workflow(ccache, "v1.2.19", { runner: "[self-hosted, windows-2022]" }),
  "ccache-workaround": workflow(ccache, "v1.2.19", {
    job: "    env:\n      CCACHE_COMPILERCHECK: content",
  }),
  "ccache-configured": workflow(ccache, "v1.2.19", {
    after: "      - run: ccache --set-config=compiler_check=content",
  }),
  "ccache-disabled-step": workflow(ccache, "v1.2.19", { step: "        if: false" }),
  "ccache-disabled-job": workflow(ccache, "v1.2.19", { job: "    if: false" }),
  "ccache-cache-off": workflow(ccache, "v1.2.19", { job: "    cache-mode: none" }),
  "ccache-non-windows-step": workflow(ccache, "v1.2.19", {
    step: "        if: runner.os != 'Windows'",
  }),
  "ccache-axis": workflow(ccache, "v1.2.19", {
    runner: "${{ matrix.os }}",
    job: "    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest]",
  }),
  "ccache-include": workflow(ccache, "v1.2.19", {
    runner: "${{ matrix.runnerName }}",
    job: "    strategy:\n      matrix:\n        include:\n          - runnerName: windows-2022\n          - runnerName: ubuntu-latest",
  }),
  "ccache-excluded": workflow(ccache, "v1.2.19", {
    runner: "${{ matrix.os }}",
    job: "    strategy:\n      matrix:\n        os: [ubuntu-latest, windows-latest]\n        exclude:\n          - os: windows-latest",
  }),
  "ccache-unrelated-matrix": workflow(ccache, "v1.2.19", {
    runner: "${{ matrix.runner }}",
    job: "    strategy:\n      matrix:\n        os: [windows-latest]\n        runner: [ubuntu-latest]",
  }),
  "ccache-dynamic-matrix": workflow(ccache, "v1.2.19", {
    runner: "${{ matrix.runner }}",
    job: "    strategy:\n      matrix: ${{ fromJSON(needs.prepare.outputs.matrix) }}",
  }),
  "ccache-multiple": workflow(ccache, "v1.2.19", {
    after: `      - uses: ${ccache}@v1.2.17`,
  }),
  "rust-old": workflow(rust, "v2.9.1"),
  "rust-linux": workflow(rust, "v2.9.1", { runner: "ubuntu-latest" }),
  "rust-older": workflow(rust, "v2.8.2"),
  "rust-fixed": workflow(rust, "v2.9.2"),
  "rust-newer": workflow(rust, "v2.10.0"),
  "rust-floating": workflow(rust, "v2"),
  "rust-partial": workflow(rust, "v2.9"),
  "rust-sha": workflow(rust, `${sha} # Swatinem/rust-cache@v2.9.1`),
  "rust-ratchet": workflow(rust, `${sha} # ratchet:Swatinem/rust-cache@v2.9.1`),
  "rust-unknown-sha": workflow(rust, sha),
  "rust-prerelease": workflow(rust, "v2.9.2-beta"),
  "rust-no-targets": workflow(rust, "v2.9.1", { config: "          cache-targets: false" }),
  "rust-no-save": workflow(rust, "v2.9.1", { config: '          save-if: "false"' }),
  "rust-read-only": workflow(rust, "v2.9.1", { job: "    cache-mode: read" }),
  "rust-write-only": workflow(rust, "v2.9.1", { job: "    cache-mode: write-only" }),
  "rust-disabled": workflow(rust, "v2.9.1", { step: "        if: false" }),
  "rust-multiple": workflow(rust, "v2.9.1", { after: `      - uses: ${rust}@v2.8.2` }),
};

describe("analyzeRepository: compilation cache action milestones", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-compilation-cache-");
    const directory = path.join(root, ".github", "workflows");
    await mkdir(directory, { recursive: true });
    await Promise.all(
      Object.entries(cases).map(([name, source]) =>
        writeFile(path.join(directory, `${name}.yml`), source),
      ),
    );
    report = await analyzeRepository({ cwd: root, targetPath: ".", mode: "strict", topCount: 200 });
  });
  function findings(name: string, rule: string) {
    return report.findings.filter(
      (finding) => finding.ruleId === rule && finding.workflow === `.github/workflows/${name}.yml`,
    );
  }

  test.each([
    "ccache-old",
    "ccache-older",
    "ccache-sha",
    "ccache-ratchet",
    "ccache-axis",
    "ccache-include",
  ])("flags old Windows ccache defaults for %s", (name) => {
    expect(findings(name, ccacheRule)).toHaveLength(1);
    expect(findings(name, ccacheRule)[0]?.severity).toBe("warning");
    expect(findings(name, ccacheRule)[0]?.suggestion).toContain("v1.2.20");
  });
  test.each([
    "ccache-fixed",
    "ccache-newer",
    "ccache-linux",
    "ccache-macos",
    "ccache-sccache",
    "ccache-dynamic-variant",
    "ccache-floating",
    "ccache-unknown-sha",
    "ccache-other-comment",
    "ccache-main-comment",
    "ccache-prerelease",
    "ccache-self-hosted",
    "ccache-workaround",
    "ccache-configured",
    "ccache-disabled-step",
    "ccache-disabled-job",
    "ccache-cache-off",
    "ccache-non-windows-step",
    "ccache-excluded",
    "ccache-unrelated-matrix",
    "ccache-dynamic-matrix",
  ])("does not flag ccache compatibility case %s", (name) => {
    expect(findings(name, ccacheRule)).toHaveLength(0);
  });
  test.each(["rust-old", "rust-linux", "rust-older", "rust-sha", "rust-ratchet"])(
    "flags target-cleanup milestone for %s",
    (name) => {
      expect(findings(name, rustRule)).toHaveLength(1);
      expect(findings(name, rustRule)[0]?.severity).toBe("warning");
      expect(findings(name, rustRule)[0]?.suggestion).toContain("v2.9.2");
      expect(findings(name, rustRule)[0]?.why).toContain("fingerprint");
    },
  );
  test.each([
    "rust-fixed",
    "rust-newer",
    "rust-floating",
    "rust-partial",
    "rust-unknown-sha",
    "rust-prerelease",
    "rust-no-targets",
    "rust-no-save",
    "rust-read-only",
    "rust-write-only",
    "rust-disabled",
  ])("does not flag rust-cache compatibility case %s", (name) => {
    expect(findings(name, rustRule)).toHaveLength(0);
  });
  test("consolidates each action's offenders per job", () => {
    expect(findings("ccache-multiple", ccacheRule)).toHaveLength(1);
    expect(findings("ccache-multiple", ccacheRule)[0]?.message).toContain("v1.2.17");
    expect(findings("rust-multiple", rustRule)).toHaveLength(1);
    expect(findings("rust-multiple", rustRule)[0]?.message).toContain("v2.8.2");
  });
});
