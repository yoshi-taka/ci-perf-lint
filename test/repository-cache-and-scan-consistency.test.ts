import { afterEach, describe, expect, test } from "bun:test";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import { buildRepositoryFeatureIndex } from "../src/repository-diagnostics/repository-feature-index.ts";
import { parseWorkflow } from "../src/workflow.ts";
import { analyzeRepository } from "../src/repo.ts";
import {
  fixtureCacheKey,
  fixtureFingerprint,
  loadFixtureCache,
  saveFixtureCache,
} from "./fixture-cache.ts";
import {
  clearTestCaches,
  createTempDirTracker,
  memoizedAnalyzeRepository,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  clearTestCaches();
  await tempDirs.cleanup();
});

describe("repository consistency", () => {
  test("refreshes dependency signals in a new scan", async () => {
    const cwd = await tempDirs.create("apl-signal-refresh-");
    await writeRepositoryFiles(cwd, { "package.json": '{"devDependencies":{"eslint":"9.33.0"}}' });
    expect(
      (await collectRepositorySignals(cwd, [], [], new RepositoryScanContext(cwd, []))).signals
        .eslint.eslintMajor,
    ).toBe(9);
    await writeRepositoryFiles(cwd, { "package.json": '{"devDependencies":{"eslint":"10.0.0"}}' });
    expect(
      (await collectRepositorySignals(cwd, [], [], new RepositoryScanContext(cwd, []))).signals
        .eslint.eslintMajor,
    ).toBe(10);
  });

  test("excludes generated directories at every depth and with a subdirectory prefix", async () => {
    const cwd = await tempDirs.create("apl-scan-exclusions-");
    await writeRepositoryFiles(cwd, {
      "src/app.ts": "export {};",
      "packages/app/src/index.ts": "export {};",
      "packages/app/node_modules/noise.ts": "export {};",
      "packages/app/dist/noise.ts": "export {};",
      "packages/app/generated/noise.ts": "export {};",
    });
    const context = new RepositoryScanContext(cwd, []);
    const options = { ignoredDirectories: new Set(["generated"]) };
    expect((await context.walkFiles(".", options)).sort()).toEqual([
      "packages/app/src/index.ts",
      "src/app.ts",
    ]);
    expect(await context.walkFiles("packages/app", options)).toEqual(["packages/app/src/index.ts"]);
  });

  test("regex flags and global state do not change cached matches", () => {
    const workflows = [1, 2].map((i) =>
      parseWorkflow(
        `/repo/ci-${i}.yml`,
        "/repo",
        "jobs:\n  test:\n    steps:\n      - run: npm ci\n",
      ),
    );
    const index = buildRepositoryFeatureIndex(workflows);
    expect(index.workflowsMatchingSource(/JOBS/)).toHaveLength(0);
    expect(index.workflowsMatchingSource(/JOBS/i)).toHaveLength(2);
    const regex = /jobs/g;
    regex.lastIndex = 999;
    expect(index.workflowsMatchingSource(regex)).toHaveLength(2);
    expect(regex.lastIndex).toBe(999);
    expect(index.workflowsMatchingStepText(/NPM/)).toHaveLength(0);
    expect(index.workflowsMatchingStepText(/NPM/gi)).toHaveLength(2);
  });
});

describe("fixture cache integrity", () => {
  test("a delayed save keeps the fingerprint of the analyzed inputs", async () => {
    const cwd = await tempDirs.create("apl-fixture-delayed-save-");
    await writeRepositoryFiles(cwd, { "package.json": "{}", "src/index.ts": "export const a=1;" });
    const options = { cwd, targetPath: ".", topCount: 1 };
    const inputFingerprint = await fixtureFingerprint(cwd);
    const report = await analyzeRepository(options);
    await writeRepositoryFiles(cwd, { "src/index.ts": "export const a=2;" });
    const key = fixtureCacheKey(options);
    await saveFixtureCache(key, report, inputFingerprint);
    expect(await loadFixtureCache(key)).toBeNull();
  });
  test("persists a report and invalidates it after any fixture input changes", async () => {
    const cwd = await tempDirs.create("apl-fixture-cache-");
    await writeRepositoryFiles(cwd, { "package.json": "{}", "src/index.ts": "export const a=1;" });
    const options = { cwd, targetPath: ".", topCount: 1 };
    const report = await analyzeRepository(options);
    const key = fixtureCacheKey(options);
    await saveFixtureCache(key, report);
    expect((await loadFixtureCache(key))?.targetPath).toBe(report.targetPath);
    await writeRepositoryFiles(cwd, { "src/index.ts": "export const a=2;" });
    expect(await loadFixtureCache(key)).toBeNull();
  });

  test("memoized top counts and edited inputs have distinct reports", async () => {
    const cwd = await tempDirs.create("apl-fixture-options-");
    await writeRepositoryFiles(cwd, {
      ".github/workflows/ci.yml":
        "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n",
    });
    const base = { cwd, targetPath: ".", mode: "exploratory" as const, workflowOnly: true };
    const one = await memoizedAnalyzeRepository({ ...base, topCount: 1 });
    const many = await memoizedAnalyzeRepository({ ...base, topCount: 20 });
    expect(one.topAggregatedFindings).toHaveLength(1);
    expect(many.topAggregatedFindings.length).toBeGreaterThan(1);
    await writeRepositoryFiles(cwd, {
      ".github/workflows/ci.yml":
        "on: push\nconcurrency: ci\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: echo ok\n",
    });
    const updated = await memoizedAnalyzeRepository({ ...base, topCount: 20 });
    expect(updated.findings.some((f) => f.ruleId === "missing-concurrency")).toBe(false);
  });
});
