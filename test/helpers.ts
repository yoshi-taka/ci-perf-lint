import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { runCli } from "../src/main.ts";
import type { WorkflowJob, WorkflowStep } from "../src/workflow.ts";
import { fixtureCacheKey, loadFixtureCache, saveFixtureCache } from "./fixture-cache.ts";

export function createLogger() {
  const lines: string[] = [];
  const errors: string[] = [];

  return {
    logger: {
      log: (...args: unknown[]) => lines.push(args.join(" ")),
      error: (...args: unknown[]) => errors.push(args.join(" ")),
    },
    lines,
    errors,
  };
}

export function createTempDirTracker() {
  const tempDirs = new Set<string>();

  return {
    async create(prefix: string): Promise<string> {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
      tempDirs.add(tempDir);
      return tempDir;
    },
    async cleanup(): Promise<void> {
      if (tempDirs.size === 0) {
        return;
      }

      const dirs = [...tempDirs];
      tempDirs.clear();
      await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    },
  };
}

export function createWorkflowJob(overrides: Partial<WorkflowJob["raw"]> = {}): WorkflowJob {
  return {
    id: "test-job",
    raw: {
      "runs-on": "ubuntu-latest",
      ...overrides,
    },
    node: {} as WorkflowJob["node"],
    idNode: undefined,
    hasIf: false,
    ifNode: undefined,
    concurrencyNode: undefined,
    steps: [],
    usesReusableWorkflow: false,
  };
}

export function createWorkflowStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    node: {} as WorkflowStep["node"],
    nameNode: undefined,
    usesNode: undefined,
    runNode: undefined,
    withNode: undefined,
    name: undefined,
    uses: undefined,
    run: undefined,
    with: undefined,
    ...overrides,
  };
}

type AnalyzeRepositoryOptions = Parameters<typeof analyzeRepository>[0];
type AnalyzeRepositoryResult = Awaited<ReturnType<typeof analyzeRepository>>;

const analyzeRepositoryCache = new Map<string, Promise<AnalyzeRepositoryResult>>();

export function clearTestCaches(): void {
  analyzeRepositoryCache.clear();
  runCliCache.clear();
}

function analyzeRepositoryCacheKey(options: AnalyzeRepositoryOptions): string {
  return fixtureCacheKey(options);
}

export function memoizedAnalyzeRepository(
  options: AnalyzeRepositoryOptions,
): Promise<AnalyzeRepositoryResult> {
  const key = analyzeRepositoryCacheKey(options);
  const cached = analyzeRepositoryCache.get(key);
  if (cached) {
    return cached;
  }

  const reportPromise = (async () => {
    const cachedData = await loadFixtureCache(key);
    if (cachedData) {
      return cachedData;
    }

    const result = await analyzeRepository(options);
    saveFixtureCache(key, result).catch(() => {});
    return result;
  })().catch((error) => {
    analyzeRepositoryCache.delete(key);
    throw error;
  });
  analyzeRepositoryCache.set(key, reportPromise);
  return reportPromise;
}

type RunCliResult = {
  exitCode: number;
  lines: string[];
  errors: string[];
};

const runCliCache = new Map<string, Promise<RunCliResult>>();

function runCliCacheKey(args: string[], cwd: string): string {
  return JSON.stringify([cwd, args]);
}

export function memoizedRunCliCapture(args: string[], cwd: string): Promise<RunCliResult> {
  const key = runCliCacheKey(args, cwd);
  const cached = runCliCache.get(key);
  if (cached) {
    return cached;
  }

  const resultPromise = (async () => {
    const { logger, lines, errors } = createLogger();
    const exitCode = await runCli(args, cwd, logger);
    return {
      exitCode,
      lines: [...lines],
      errors: [...errors],
    };
  })().catch((error) => {
    runCliCache.delete(key);
    throw error;
  });
  runCliCache.set(key, resultPromise);
  return resultPromise;
}
