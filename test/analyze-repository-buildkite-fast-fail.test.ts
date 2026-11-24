import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

async function writePipeline(root: string, lines: string[]) {
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "pipeline.yml"), ["steps:", ...lines].join("\n"));
}

async function findings(root: string) {
  const report = await getFixtureReport(root, {
    targetPath: ".",
    topCount: 10,
    mode: "exploratory",
  });
  return report.findings.filter((finding) => finding.ruleId === "missing-cancel-on-build-failing");
}

describe("missing-cancel-on-build-failing", () => {
  test("fires for parallel test shards without the attribute", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-parallelism-");
    await writePipeline(root, [
      "  - label: ':test_tube: Tests'",
      "    command: npm test",
      "    parallelism: 5",
    ]);
    const found = await findings(root);
    expect(found).toHaveLength(1);
  });

  test("fires for a segment with two unfiltered command steps", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-segment-");
    await writePipeline(root, [
      "  - label: Lint",
      "    command: make lint",
      "  - label: Tests",
      "    command: npm test",
    ]);
    expect(await findings(root)).toHaveLength(1);
  });

  test("does not fire when cancel_on_build_failing is set", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-set-");
    await writePipeline(root, [
      "  - label: Lint",
      "    command: make lint",
      "  - label: Tests",
      "    command: npm test",
      "    cancel_on_build_failing: true",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not fire for sequential pipelines", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-sequential-");
    await writePipeline(root, [
      "  - label: Build",
      "    command: make build",
      "  - wait",
      "  - label: Test",
      "    command: npm test",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not count branch-exclusive segment neighbors as concurrent", async () => {
    // Real-pipeline shape: a non-default-branch gate next to a
    // default-branch build step. They never run in the same build.
    const root = await tempDirs.create("apl-bk-fastfail-branchexclusive-");
    await writePipeline(root, [
      "  - label: ':mag: Preview gate'",
      '    branches: "!main"',
      "    command: .buildkite/scripts/preview_gate.sh",
      "  - label: ':docker: Build'",
      '    branches: "main"',
      "    command: .buildkite/scripts/build.sh",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("counts group inner steps for segment concurrency", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-group-");
    await writePipeline(root, [
      "  - group: ':package: Package'",
      "    steps:",
      "      - label: x86_64",
      "        command: ./scripts/package-x86.sh",
      "      - label: arm64",
      "        command: ./scripts/package-arm.sh",
    ]);
    expect(await findings(root)).toHaveLength(1);
  });

  test("ignores skipped steps when counting concurrency", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-skipped-");
    await writePipeline(root, [
      "  - label: Tests",
      "    command: npm test",
      "  - label: Old",
      "    command: make old",
      "    skip: true",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });
});
