import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ResolvedMutationConfig } from "./config.ts";
import { applyMutant } from "./apply.ts";
import { generateMutants, type Mutant, type MutatorName } from "./mutators.ts";

export type MutantStatus = "Killed" | "Survived" | "Timeout";

export interface LocatedMutant {
  id: string;
  file: string;
  mutator: MutatorName;
  start: number;
  end: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  replacement: string;
  status: MutantStatus;
  durationMS: number;
  stderrTail?: string;
}

export interface RunSummary {
  name: string;
  files: { file: string; mutants: LocatedMutant[] }[];
  metrics: {
    total: number;
    killed: number;
    survived: number;
    timeout: number;
    score: number;
    durationMS: number;
  };
  unsupportedSites: string[];
  regexSites: number;
}

export interface RunOptions {
  projectRoot?: string;
  /** Run every config in a copied sandbox, even when the config sets inPlace. */
  forceSandbox?: boolean;
  /** Number of mutants to run concurrently. Values above 1 force sandboxes. */
  jobs?: number;
  onProgress?: (done: number, total: number, mutant: LocatedMutant) => void;
  log?: (message: string) => void;
}

interface CommandResult {
  code: number | null;
  timedOut: boolean;
  stderr: string;
}

const sandboxEntries = [
  "src",
  "test",
  "scripts",
  "docs",
  "package.json",
  "bunfig.toml",
  "tsconfig.json",
];

export interface CollectedMutant extends Mutant {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface Collection {
  mutants: CollectedMutant[];
  sources: Map<string, string>;
  unsupportedSites: string[];
  regexSites: number;
}

export async function collectMutants(
  config: ResolvedMutationConfig,
  projectRoot = config.projectRoot,
): Promise<Collection> {
  const sources = new Map<string, string>();
  for (const target of config.targets) {
    const absolute = path.resolve(projectRoot, target.file);
    if (!existsSync(absolute)) {
      throw new Error(`Mutate target does not exist: ${target.file}`);
    }
    sources.set(target.file, await readFile(absolute, "utf8"));
  }

  const mutants: CollectedMutant[] = [];
  let unsupportedSites: string[] = [];
  let regexSites = 0;
  for (const target of config.targets) {
    const source = sources.get(target.file);
    if (source === undefined) {
      continue;
    }
    const result = generateMutants(target.file, source);
    unsupportedSites = unsupportedSites.concat(result.unsupportedSites);
    regexSites += result.regexSites;
    for (const mutant of result.mutants) {
      const startLocation = offsetToLineColumn(source, mutant.start);
      const lineRange = target.lineRange;
      if (
        lineRange &&
        (startLocation.line < lineRange.start || startLocation.line > lineRange.end)
      ) {
        continue;
      }
      const endLocation = offsetToLineColumn(source, mutant.end);
      mutants.push({
        ...mutant,
        line: startLocation.line,
        column: startLocation.column,
        endLine: endLocation.line,
        endColumn: endLocation.column,
      });
    }
  }
  return { mutants, sources, unsupportedSites, regexSites };
}

export async function runMutationConfig(
  config: ResolvedMutationConfig,
  options: RunOptions = {},
): Promise<RunSummary> {
  const projectRoot = options.projectRoot ?? config.projectRoot;
  const log = options.log ?? (() => {});
  const startedAt = Date.now();
  const {
    mutants: generated,
    sources,
    unsupportedSites,
    regexSites,
  } = await collectMutants(config, projectRoot);

  if (generated.length === 0) {
    throw new Error(
      `No mutants generated for ${config.name}; check mutate targets and line ranges`,
    );
  }

  const jobs = Math.max(1, Math.floor(options.jobs ?? 1));
  const useSandbox = !config.inPlace || options.forceSandbox === true || jobs > 1;
  const tempRoot = path.resolve(projectRoot, config.tempDirName);
  if (useSandbox && config.cleanTempDir) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  const workspaces: Workspace[] = [];
  for (let workerIndex = 0; workerIndex < jobs; workerIndex += 1) {
    workspaces.push(await createWorkspace(config, projectRoot, useSandbox, workerIndex));
  }
  const restoreAll = (): void => {
    for (const workspace of workspaces) {
      workspace.restore();
    }
  };
  const state: { restored: boolean } = { restored: false };
  const onSignal = (): void => {
    if (!state.restored) {
      restoreAll();
      state.restored = true;
    }
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const baselineTmp = path.join(tempRoot, "tmp", "baseline");
    await mkdir(baselineTmp, { recursive: true });
    let baseline: CommandResult;
    try {
      baseline = await runCommand(
        config.command,
        workspaces[0]!.dir,
        Math.max(config.timeoutMS * 20, 60_000),
        { TMPDIR: baselineTmp },
      );
    } finally {
      await rm(baselineTmp, { recursive: true, force: true });
    }
    if (baseline.code !== 0 || baseline.timedOut) {
      throw new Error(
        `Baseline test run failed for ${config.name} (exit ${String(baseline.code)})${baseline.timedOut ? " [timeout]" : ""}\n${baseline.stderr.slice(-2000)}`,
      );
    }

    log(
      `[mutation:${config.name}] ${generated.length} mutants across ${config.targets.length} files (${jobs} worker${jobs === 1 ? "" : "s"})`,
    );
    const results: (LocatedMutant | undefined)[] = new Array(generated.length);
    let cursor = 0;
    let done = 0;
    let failure: unknown;
    const runWorker = async (workspace: Workspace, workerIndex: number): Promise<void> => {
      while (failure === undefined) {
        const index = cursor;
        cursor += 1;
        if (index >= generated.length) {
          return;
        }
        const mutant = generated[index]!;
        const source = sources.get(mutant.file);
        if (source === undefined) {
          failure = new Error(`Missing source for ${mutant.file}`);
          return;
        }
        const mutated = applyMutant(source, mutant);
        const mutantTmp = mutantTempPath(tempRoot, workerIndex, index);
        try {
          await mkdir(mutantTmp, { recursive: true });
          await workspace.write(mutant.file, mutated);
          const commandStartedAt = Date.now();
          let result: CommandResult;
          try {
            result = await runCommand(config.command, workspace.dir, config.timeoutMS, {
              TMPDIR: mutantTmp,
            });
          } finally {
            await workspace.write(mutant.file, source);
          }
          const status: MutantStatus = result.timedOut
            ? "Timeout"
            : result.code === 0
              ? "Survived"
              : "Killed";
          const located: LocatedMutant = {
            id: String(index),
            file: mutant.file,
            mutator: mutant.mutator,
            start: mutant.start,
            end: mutant.end,
            line: mutant.line,
            column: mutant.column,
            endLine: mutant.endLine,
            endColumn: mutant.endColumn,
            replacement: mutant.replacement,
            status,
            durationMS: Date.now() - commandStartedAt,
            ...(status === "Survived" ? { stderrTail: result.stderr.slice(-1000) } : {}),
          };
          results[index] = located;
          done += 1;
          options.onProgress?.(done, generated.length, located);
        } catch (error) {
          failure = error;
          return;
        } finally {
          await rm(mutantTmp, { recursive: true, force: true });
        }
      }
    };
    await Promise.all(
      workspaces.map((workspace, workerIndex) => runWorker(workspace, workerIndex)),
    );
    if (failure !== undefined) {
      throw failure;
    }
    const completed = results.filter((result): result is LocatedMutant => result !== undefined);

    const files = config.targets.map((target) => ({
      file: target.file,
      mutants: completed.filter((mutant) => mutant.file === target.file),
    }));
    const killed = completed.filter((mutant) => mutant.status === "Killed").length;
    const survived = completed.filter((mutant) => mutant.status === "Survived").length;
    const timeout = completed.filter((mutant) => mutant.status === "Timeout").length;
    const summary: RunSummary = {
      name: config.name,
      files,
      metrics: {
        total: completed.length,
        killed,
        survived,
        timeout,
        score: completed.length === 0 ? 0 : (killed + timeout) / completed.length,
        durationMS: Date.now() - startedAt,
      },
      unsupportedSites,
      regexSites,
    };
    if (completed.length !== generated.length) {
      throw new Error(`Stopped after ${completed.length}/${generated.length} mutants`);
    }

    if (config.jsonFile) {
      await writeJsonReport(config, summary, projectRoot);
    }
    return summary;
  } finally {
    if (!state.restored) {
      restoreAll();
      state.restored = true;
    }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await cleanupWorkspace(config, projectRoot, useSandbox);
  }
}

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - before.lastIndexOf("\n") - 1,
  };
}

export function workerSandboxPath(tempRoot: string, workerIndex: number): string {
  return path.join(tempRoot, `worker-${workerIndex}`);
}

export function mutantTempPath(tempRoot: string, workerIndex: number, index: number): string {
  return path.join(tempRoot, "tmp", `worker-${workerIndex}`, String(index));
}

interface Workspace {
  dir: string;
  write: (file: string, content: string) => Promise<void>;
  restore: () => void;
}

async function createWorkspace(
  config: ResolvedMutationConfig,
  projectRoot: string,
  useSandbox: boolean,
  workerIndex: number,
): Promise<Workspace> {
  if (!useSandbox) {
    const tempRoot = path.resolve(projectRoot, config.tempDirName);
    const backupDir = path.join(tempRoot, "backup");
    recoverBackup(
      projectRoot,
      backupDir,
      config.targets.map((target) => target.file),
    );
    const originals = new Map<string, string>();
    for (const target of config.targets) {
      originals.set(target.file, await readFile(path.resolve(projectRoot, target.file), "utf8"));
    }
    for (const [file, source] of originals) {
      const backupPath = path.join(backupDir, file);
      mkdirSync(path.dirname(backupPath), { recursive: true });
      writeFileSync(backupPath, source);
    }
    return {
      dir: projectRoot,
      write: async (file, content) => {
        await writeFile(path.resolve(projectRoot, file), content);
      },
      restore: () => {
        for (const [file, source] of originals) {
          writeFileSync(path.resolve(projectRoot, file), source);
        }
        rmSync(backupDir, { recursive: true, force: true });
      },
    };
  }

  const tempRoot = path.resolve(projectRoot, config.tempDirName);
  const sandboxDir = workerSandboxPath(tempRoot, workerIndex);
  await mkdir(sandboxDir, { recursive: true });
  for (const entry of sandboxEntries) {
    if (matchesIgnorePattern(entry, config.ignorePatterns)) {
      continue;
    }
    const source = path.join(projectRoot, entry);
    if (!existsSync(source)) {
      continue;
    }
    await cp(source, path.join(sandboxDir, entry), { recursive: true });
  }
  // The test preload (test/setup.ts) imports helpers and fast-check on every
  // process. Mutation commands do not need the seed hook, and Bun isolates
  // test files by default, so skip it to remove ~40ms per mutant.
  await writeFile(path.join(sandboxDir, "bunfig.toml"), "");
  const nodeModules = path.join(projectRoot, "node_modules");
  if (existsSync(nodeModules)) {
    await symlink(nodeModules, path.join(sandboxDir, "node_modules"), "dir");
  }
  const fixtureCache = path.join(projectRoot, ".fixture-cache");
  if (existsSync(fixtureCache)) {
    await symlink(fixtureCache, path.join(sandboxDir, ".fixture-cache"), "dir");
  }
  return {
    dir: sandboxDir,
    write: async (file, content) => {
      await writeFile(path.join(sandboxDir, file), content);
    },
    restore: () => {},
  };
}

async function cleanupWorkspace(
  config: ResolvedMutationConfig,
  projectRoot: string,
  useSandbox: boolean,
): Promise<void> {
  if (!useSandbox) {
    await rm(path.resolve(projectRoot, config.tempDirName), { recursive: true, force: true });
    return;
  }
  if (config.cleanTempDir) {
    await rm(path.resolve(projectRoot, config.tempDirName), { recursive: true, force: true });
  }
}

function matchesIgnorePattern(entry: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return entry === prefix || entry.startsWith(`${prefix}/`);
    }
    return entry === pattern;
  });
}

function recoverBackup(projectRoot: string, backupDir: string, files: string[]): void {
  if (!existsSync(backupDir)) {
    return;
  }
  for (const file of files) {
    const backupPath = path.join(backupDir, file);
    if (existsSync(backupPath)) {
      writeFileSync(path.resolve(projectRoot, file), readFileSync(backupPath));
    }
  }
  rmSync(backupDir, { recursive: true, force: true });
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutMS: number,
  env: Record<string, string> = {},
): Promise<CommandResult> {
  const proc = Bun.spawn(["/bin/sh", "-c", command], {
    cwd,
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env, AGENT: "1", ...env },
    detached: true,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill(9);
    }
  }, timeoutMS);
  const stderrPromise = new Response(proc.stderr).text();
  const code = await proc.exited;
  clearTimeout(timer);
  const stderr = await stderrPromise;
  return { code, timedOut, stderr };
}

async function writeJsonReport(
  config: ResolvedMutationConfig,
  summary: RunSummary,
  projectRoot: string,
): Promise<void> {
  if (!config.jsonFile) {
    return;
  }
  const report = {
    schemaVersion: "1",
    config: config.name,
    projectRoot,
    generatedAt: new Date().toISOString(),
    metrics: summary.metrics,
    files: Object.fromEntries(
      summary.files.map((file) => [
        file.file,
        {
          mutants: file.mutants.map((mutant) => ({
            id: mutant.id,
            mutatorName: mutant.mutator,
            location: {
              start: { line: mutant.line, column: mutant.column },
              end: { line: mutant.endLine, column: mutant.endColumn },
            },
            replacement: mutant.replacement,
            status: mutant.status,
            durationMS: mutant.durationMS,
          })),
        },
      ]),
    ),
  };
  const reportPath = path.resolve(projectRoot, config.jsonFile);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
