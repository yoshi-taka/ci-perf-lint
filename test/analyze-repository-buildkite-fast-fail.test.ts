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
  test("does not suggest canceling concurrent deployments", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-deployments-");
    await writePipeline(root, [
      "  - label: Deploy region one",
      "    command: ./rollout.sh",
      "  - label: Deploy region two",
      "    command: ./rollout.sh",
      "    parallelism: 2",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("targets tests rather than their concurrent deployment", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-mixed-deployment-");
    await writePipeline(root, [
      "  - label: Deploy",
      "    command: ./rollout.sh",
      "  - label: Tests",
      "    command: npm test",
    ]);
    const found = await findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.aiHandoff).toContain('step "Tests"');
    expect(found[0]?.suggestion).toContain("Never apply it to deployment steps");
    expect(found[0]?.measurementHint).toContain("successful builds do not get faster");
  });

  test("does not carry a cancellation candidate across wait barriers", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-deploy-barrier-");
    await writePipeline(root, [
      "  - command: npm test",
      "  - wait",
      "  - label: Deploy one",
      "    command: ./rollout.sh",
      "  - label: Deploy two",
      "    command: ./rollout.sh",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });
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
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts/package-x86.sh"), "echo packaging\n");
    await writeFile(path.join(root, "scripts/package-arm.sh"), "echo packaging\n");
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

  test("ignores skipped parallel shards", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-skipped-shards-");
    await writePipeline(root, ["  - command: npm test", "    parallelism: 5", "    skip: true"]);
    expect(await findings(root)).toHaveLength(0);
  });

  test.each([
    "    depends_on: build",
    "    depends_on: [build]",
    "    depends_on:\n      - step: build\n        allow_failure: true",
  ])("does not count serialized neighbors (%s)", async (dependency) => {
    const root = await tempDirs.create("apl-bk-fastfail-dependencies-");
    await writePipeline(root, [
      "  - key: build",
      "    command: make build",
      "  - command: npm test",
      dependency,
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("still detects parallel shards after dependencies", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-dependent-shards-");
    await writePipeline(root, [
      "  - key: build",
      "    command: make build",
      "  - command: npm test",
      "    depends_on: build",
      "    parallelism: 5",
    ]);
    expect(await findings(root)).toHaveLength(1);
  });

  test("still detects independent work beside a dependency chain", async () => {
    const root = await tempDirs.create("apl-bk-fastfail-independent-");
    await writePipeline(root, [
      "  - key: build",
      "    command: make build",
      "  - command: npm test",
      "    depends_on: build",
      "  - command: make lint",
    ]);
    expect(await findings(root)).toHaveLength(1);
  });
});
