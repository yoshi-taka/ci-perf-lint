import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(async () => {
  await tempDirs.cleanup();
});

const milestones = [
  {
    id: "prefer-sccache-action-0-0-6",
    action: "mozilla-actions/sccache-action",
    old: "v0.0.5",
    fixed: "v0.0.6",
    future: "v0.0.11",
    moving: "v0.0",
    inputs: "          version: v0.10.0",
    runner: "[self-hosted, linux]",
  },
  {
    id: "prefer-cache-apt-pkgs-action-1-3-1",
    action: "awalsh128/cache-apt-pkgs-action",
    old: "v1.3.0",
    fixed: "v1.3.1",
    future: "v1.4.0",
    moving: "v1.3",
    inputs: "          packages: libssl-dev libpq-dev",
    runner: "ubuntu-latest",
  },
  {
    id: "prefer-install-action-2-38-for-nextest",
    action: "taiki-e/install-action",
    old: "v2.37.0",
    fixed: "v2.38.0",
    future: "v2.87.0",
    moving: "v2",
    inputs: "          tool: cargo-nextest@0.9.70,just,cargo-hack",
    runner: "ubuntu-latest",
  },
  {
    id: "prefer-test-reporter-2-3-for-xml",
    action: "dorny/test-reporter",
    old: "v2.2.0",
    fixed: "v2.3.0",
    future: "v3.0.0",
    moving: "v2",
    inputs: "          name: Tests\n          path: results/*.xml\n          reporter: jest-junit",
    runner: "ubuntu-latest",
  },
  {
    id: "prefer-pulumi-actions-4-2",
    action: "pulumi/actions",
    old: "v4.1.0",
    fixed: "v4.2.0",
    future: "v6.0.0",
    moving: "v4",
    inputs:
      "          command: preview\n          stack-name: dev\n          pulumi-version: '3.100.0'",
    runner: "[self-hosted, linux]",
  },
] as const;

type Milestone = (typeof milestones)[number];
function step(milestone: Milestone, ref: string, inputs: string, condition = ""): string {
  return `      - uses: ${milestone.action}@${ref}
${condition}
        with:
${inputs}`;
}
function workflow(
  milestone: Milestone,
  ref: string,
  extra: {
    inputs?: string;
    runner?: string;
    job?: string;
    condition?: string;
    before?: string;
    after?: string;
  } = {},
): string {
  return `name: Action milestone
on: push
jobs:
  test:
    runs-on: ${extra.runner ?? milestone.runner}
${extra.job ?? ""}
    steps:
${extra.before ?? ""}
${step(milestone, ref, extra.inputs ?? milestone.inputs, extra.condition)}
${extra.after ?? ""}
`;
}

const sha = "a".repeat(40);
const cases: Record<string, string> = {};
for (const milestone of milestones) {
  const prefix = milestone.id;
  for (const [name, ref] of [
    ["old", milestone.old],
    ["fixed", milestone.fixed],
    ["future", milestone.future],
    ["moving", milestone.moving],
    ["branch", "main"],
    ["prerelease", `${milestone.old}-rc.1`],
    ["unknown-sha", sha],
    ["sha-comment", `${sha} # ${milestone.old}`],
    ["ratchet", `${sha} # ratchet:${milestone.action}@${milestone.old}`],
    ["pin-comment", `${sha} # pin ${milestone.old}`],
    ["fixed-pin-comment", `${sha} # pin ${milestone.fixed}`],
    ["fixed-sha", `${sha} # ${milestone.fixed}`],
    ["misleading-comment", `${milestone.fixed} # ${milestone.old}`],
  ]) {
    cases[`${prefix}-${name}`] = workflow(milestone, ref!);
  }
  cases[`${prefix}-disabled-job`] = workflow(milestone, milestone.old, { job: "    if: false" });
  cases[`${prefix}-disabled-step`] = workflow(milestone, milestone.old, {
    condition: "        if: false",
  });
  cases[`${prefix}-disabled-string`] = workflow(milestone, milestone.old, {
    condition: '        if: "false"',
  });
  cases[`${prefix}-multiple`] = workflow(milestone, milestone.old, {
    after: step(milestone, milestone.old, milestone.inputs),
  });
}

const [sccache, apt, install, reporter, pulumi] = milestones;
cases["sccache-hosted"] = workflow(sccache, sccache.old, { runner: "ubuntu-latest" });
cases["sccache-unknown-runner"] = workflow(sccache, sccache.old, {
  runner: "${{ matrix.runner }}",
});
cases["sccache-container"] = workflow(sccache, sccache.old, { job: "    container: ubuntu:24.04" });
cases["apt-empty"] = workflow(apt, apt.old, { inputs: "          packages: ''" });
cases["apt-missing"] = workflow(apt, apt.old, { inputs: "          version: 1" });
cases["apt-dynamic"] = workflow(apt, apt.old, {
  inputs: "          packages: ${{ inputs.packages }}",
});
cases["apt-before-fast"] = workflow(apt, "v1.0.3");
cases["install-minor"] = workflow(install, "v2.37", { inputs: "          tool: cargo-nextest" });
cases["install-nextest-alias"] = workflow(install, `${sha} # pin v2.33.34`, {
  inputs: "          tool: nextest@0.9.54, wasm-pack@0.11.0, cargo-deny@0.14.3",
});
cases["install-nextest-unpinned"] = workflow(install, install.old, {
  inputs: "          tool: nextest",
});
cases["install-other-tool"] = workflow(install, install.old, {
  inputs: "          tool: just,cargo-hack",
});
cases["install-similar-name"] = workflow(install, install.old, {
  inputs: "          tool: cargo-nextest-extra",
});
cases["install-dynamic"] = workflow(install, install.old, {
  inputs: "          tool: cargo-nextest,${{ inputs.tool }}",
});
cases["install-missing"] = workflow(install, install.old, { inputs: "          checksum: true" });
for (const format of [
  "dotnet-nunit",
  "dotnet-trx",
  "java-junit",
  "python-xunit",
  "swift-xunit",
  "golang-json",
  "mocha-json",
  "dart-json",
  "flutter-json",
  "rspec-json",
  "unknown",
  "${{ inputs.reporter }}",
]) {
  const name = format.includes("${{") ? "dynamic" : format;
  cases[`reporter-${name}`] = workflow(reporter, reporter.old, {
    inputs: `          reporter: ${format}`,
  });
}
cases["reporter-minor"] = workflow(reporter, "v2.2");
cases["reporter-missing"] = workflow(reporter, reporter.old, {
  inputs: "          path: results/*.xml",
});
cases["pulumi-hosted"] = workflow(pulumi, pulumi.old, { runner: "ubuntu-latest" });
cases["pulumi-container"] = workflow(pulumi, pulumi.old, { job: "    container: ubuntu:24.04" });
cases["pulumi-dynamic"] = workflow(pulumi, pulumi.old, {
  inputs: "          pulumi-version: ${{ inputs.version }}",
});
cases["pulumi-latest"] = workflow(pulumi, pulumi.old, {
  inputs: "          pulumi-version: latest",
});
cases["pulumi-default"] = workflow(pulumi, pulumi.old, { inputs: "          command: preview" });
cases["pulumi-minor"] = workflow(pulumi, "v4.1");
cases["pulumi-repeated"] = workflow(pulumi, pulumi.old, {
  runner: "ubuntu-latest",
  before: step(pulumi, pulumi.old, pulumi.inputs),
});
cases["pulumi-repeated-default"] = workflow(pulumi, pulumi.old, {
  runner: "ubuntu-latest",
  inputs: "          pulumi-version: '^3'",
  before: step(pulumi, pulumi.old, "          command: preview"),
});
cases["pulumi-conditional-predecessor"] = workflow(pulumi, pulumi.old, {
  runner: "ubuntu-latest",
  before: step(pulumi, pulumi.old, pulumi.inputs, "        if: ${{ inputs.deploy }}"),
});
cases["pulumi-disabled-predecessor"] = workflow(pulumi, pulumi.old, {
  runner: "ubuntu-latest",
  before: step(pulumi, pulumi.old, pulumi.inputs, "        if: false"),
});
cases["pulumi-different-constraint"] = workflow(pulumi, pulumi.old, {
  runner: "ubuntu-latest",
  before: step(pulumi, pulumi.old, "          pulumi-version: '3.99.0'"),
});
cases["pulumi-later-install"] = workflow(pulumi, pulumi.old, {
  runner: "ubuntu-latest",
  after: step(pulumi, pulumi.fixed, pulumi.inputs),
});

describe("analyzeRepository: third-party Action performance milestones", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-action-milestones-");
    const directory = path.join(root, ".github", "workflows");
    await mkdir(directory, { recursive: true });
    await Promise.all(
      Object.entries(cases).map(([name, source]) =>
        writeFile(path.join(directory, `${name}.yml`), source),
      ),
    );
    report = await analyzeRepository({ cwd: root, targetPath: ".", mode: "strict", topCount: 500 });
  });
  function findings(name: string, id: string) {
    return report.findings.filter(
      (finding) => finding.ruleId === id && finding.workflow === `.github/workflows/${name}.yml`,
    );
  }
  for (const milestone of milestones) {
    for (const name of ["old", "sha-comment", "ratchet", "pin-comment", "multiple"]) {
      test(`${milestone.id}: flags ${name} once per job`, () => {
        const matches = findings(`${milestone.id}-${name}`, milestone.id);
        expect(matches).toHaveLength(1);
        expect(matches[0]?.severity).toBe("warning");
        expect(matches[0]?.location.path).toBe(`.github/workflows/${milestone.id}-${name}.yml`);
        expect(matches[0]?.message).toContain(milestone.action);
        expect(matches[0]?.suggestion).toContain(milestone.fixed);
      });
    }
    for (const name of [
      "fixed",
      "future",
      "moving",
      "branch",
      "prerelease",
      "unknown-sha",
      "fixed-sha",
      "fixed-pin-comment",
      "misleading-comment",
      "disabled-job",
      "disabled-step",
      "disabled-string",
    ]) {
      test(`${milestone.id}: excludes ${name}`, () => {
        expect(findings(`${milestone.id}-${name}`, milestone.id)).toHaveLength(0);
      });
    }
  }
  test.each([
    ["apt-before-fast", apt.id],
    ["install-minor", install.id],
    ["install-nextest-alias", install.id],
    ["install-nextest-unpinned", install.id],
    ["reporter-minor", reporter.id],
    ["reporter-dotnet-nunit", reporter.id],
    ["reporter-dotnet-trx", reporter.id],
    ["reporter-java-junit", reporter.id],
    ["reporter-python-xunit", reporter.id],
    ["reporter-swift-xunit", reporter.id],
    ["pulumi-default", pulumi.id],
    ["pulumi-minor", pulumi.id],
    ["pulumi-repeated", pulumi.id],
    ["pulumi-repeated-default", pulumi.id],
  ])("flags applicable setup: %s", (name, id) => {
    expect(findings(name, id)).toHaveLength(1);
  });
  test.each([
    ["sccache-hosted", sccache.id],
    ["sccache-unknown-runner", sccache.id],
    ["sccache-container", sccache.id],
    ["apt-empty", apt.id],
    ["apt-missing", apt.id],
    ["apt-dynamic", apt.id],
    ["install-other-tool", install.id],
    ["install-similar-name", install.id],
    ["install-dynamic", install.id],
    ["install-missing", install.id],
    ["reporter-golang-json", reporter.id],
    ["reporter-mocha-json", reporter.id],
    ["reporter-dart-json", reporter.id],
    ["reporter-flutter-json", reporter.id],
    ["reporter-rspec-json", reporter.id],
    ["reporter-unknown", reporter.id],
    ["reporter-dynamic", reporter.id],
    ["reporter-missing", reporter.id],
    ["pulumi-hosted", pulumi.id],
    ["pulumi-container", pulumi.id],
    ["pulumi-dynamic", pulumi.id],
    ["pulumi-latest", pulumi.id],
    ["pulumi-conditional-predecessor", pulumi.id],
    ["pulumi-disabled-predecessor", pulumi.id],
    ["pulumi-different-constraint", pulumi.id],
    ["pulumi-later-install", pulumi.id],
  ])("excludes unaffected or unknown setup: %s", (name, id) => {
    expect(findings(name, id)).toHaveLength(0);
  });
  test("anchors repeated Pulumi setup on the redundant installation", () => {
    expect(findings("pulumi-repeated", pulumi.id)[0]?.location.line).toBeGreaterThan(10);
  });
  test("does not fail rule execution", () => {
    expect(
      report.analysisWarnings.filter((warning) => /Rule .* failed/.test(warning.message)),
    ).toEqual([]);
  });
});
