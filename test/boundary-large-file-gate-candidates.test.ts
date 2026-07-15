import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { repositoryLooksLargeFilesHeavy } from "../src/repository-diagnostics/imports-shared.ts";
import { largeFileCandidateIndex } from "../src/repository-diagnostics/large-file-candidates.ts";
import { collectLargeFileDiagnostics } from "../src/repository-diagnostics/large-files.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import type { RepositorySignals } from "../src/repository-signals-types.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
const repository = {
  workflowCount: 1,
  primaryWorkflowPath: ".github/workflows/ci.yml",
} as RepositorySignals;

async function git(repoRoot: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-C", repoRoot, ...args], { stdio: ["ignore", "ignore", "pipe"] });
  if ((await proc.exited) !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
}

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("large-file gate and collector candidates", () => {
  test("shares cached candidate layers without changing normal-path parity", async () => {
    const repoRoot = await tempDirs.create("apl-large-file-candidate-cache-");
    await writeFile(path.join(repoRoot, "data.parquet"), "x".repeat(11 * 1024 * 1024));
    await git(repoRoot, "init");
    await git(repoRoot, "add", "data.parquet");

    const context = new RepositoryScanContext(repoRoot, []);
    const first = largeFileCandidateIndex(context);
    const gate = first.gate();
    const collector = first.collector();

    expect(largeFileCandidateIndex(context)).toBe(first);
    expect(first.gate()).toBe(gate);
    expect(first.collector()).toBe(collector);
    expect(await gate).toEqual(["data.parquet"]);
    expect(await collector).toEqual(["data.parquet"]);
  });

  test("gate skips tracked files in ignored directories while collector retains them", async () => {
    const repoRoot = await tempDirs.create("apl-large-file-tracked-ignored-");
    const filePath = path.join(repoRoot, "node_modules", "fixture", "archive.zip");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "x".repeat(11 * 1024 * 1024));
    await git(repoRoot, "init");
    await git(repoRoot, "add", "--force", "node_modules/fixture/archive.zip");

    const context = new RepositoryScanContext(repoRoot, []);
    const gate = await repositoryLooksLargeFilesHeavy(context);
    const findings = await collectLargeFileDiagnostics(repoRoot, repository, [], context);

    expect(gate.value).toBe(false);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("node_modules/fixture/archive.zip");
  });

  test("gate includes root artifact directories while collector removes their candidates", async () => {
    const repoRoot = await tempDirs.create("apl-large-file-root-artifact-");
    const filePath = path.join(repoRoot, "runs", "run1", "data.parquet");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "x".repeat(11 * 1024 * 1024));
    await git(repoRoot, "init");
    await git(repoRoot, "add", "runs/run1/data.parquet");

    const context = new RepositoryScanContext(repoRoot, []);
    const gate = await repositoryLooksLargeFilesHeavy(context);
    const findings = await collectLargeFileDiagnostics(repoRoot, repository, [], context);

    expect(gate.value).toBe(true);
    expect(findings).toEqual([]);
  });
});
