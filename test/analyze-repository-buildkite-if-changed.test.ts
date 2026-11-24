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
    mode: "strict",
  });
  return report.findings.filter((finding) => finding.ruleId === "missing-if-changed");
}

describe("missing-if-changed", () => {
  test("flags a heavy test step without if_changed", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-heavy-");
    await writePipeline(root, ["  - label: ':golang: Tests'", "    command: go test ./..."]);
    const found = await findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('Step ":golang: Tests"');
  });

  test("does not flag steps that already use if_changed", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-set-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      '    if_changed: "{**.go,go.mod,go.sum}"',
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag deploy-shaped steps", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-deploy-");
    await writePipeline(root, [
      "  - label: ':rocket: Release'",
      "    command: ./scripts/publish-images.sh",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag steps restricted to the default branch", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-main-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      '    branches: "main"',
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag steps whose if expression mentions main", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-ifmain-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      '    if: build.branch == "main"',
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("flags steps excluded from the default branch", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-notmain-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      '    branches: "!main"',
    ]);
    expect(await findings(root)).toHaveLength(1);
  });

  test("flags steps whose if expression excludes the default branch", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-negmain-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      "    if: 'build.branch != \"main\"'",
    ]);
    expect(await findings(root)).toHaveLength(1);
  });

  test("treats bare-name branch restrictions as pinned regardless of the name", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-master-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      '    branches: "master"',
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag steps whose if expression pins to master", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-pinned-master-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      "    if: 'build.branch == \"master\"'",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("flags steps whose if expression excludes master", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-excl-master-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      "    if: 'build.branch != \"master\"'",
    ]);
    expect(await findings(root)).toHaveLength(1);
  });

  test("treats main-only branches as restricted even with a contradicting if", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-main-negmain-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      '    branches: "main"',
      "    if: 'build.branch != \"main\"'",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag steps using monorepo-diff", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-monorepo-");
    await writePipeline(root, [
      "  - label: ':golang: Tests'",
      "    command: go test ./...",
      "    plugins:",
      "      - monorepo-diff#v1.0: {}",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag light steps", async () => {
    const root = await tempDirs.create("apl-bk-ifchanged-light-");
    await writePipeline(root, ["  - label: ':memo: Note'", "    command: echo done"]);
    expect(await findings(root)).toHaveLength(0);
  });
});
