import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, symlinkSync } from "node:fs";
import path from "node:path";
import type { FileSink } from "bun";
import type { ResolvedMutationConfig } from "./config.ts";
import { applyMutant } from "./apply.ts";
import type {
  CollectedMutant,
  LocatedMutant,
  MutantStatus,
  RunOptions,
  RunSummary,
} from "./runner.ts";

interface HarnessInput {
  config: ResolvedMutationConfig;
  projectRoot: string;
  mutants: CollectedMutant[];
  sources: Map<string, string>;
  unsupportedSites: string[];
  regexSites: number;
  options: RunOptions;
  commandsByTarget: Map<string, string>;
  jobs: number;
}

interface Child {
  proc: ReturnType<typeof Bun.spawn>;
  runId: number;
  pending: Map<number, (value: { failed: string[] } | "error") => void>;
  tmp: string;
}

const sandboxEntries = [
  "src",
  "test",
  "scripts",
  "docs",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.json",
];

function testFilesFromCommand(command: string): string[] {
  return command
    .split(/\s+/)
    .filter((token) => /^test\/.*\.test\.ts$/.test(token))
    .map((token) => token.replace(/^test\//, ""));
}

export function harnessEligibleTargets(
  config: ResolvedMutationConfig,
  sources?: Map<string, string>,
): string[] {
  if (testFilesFromCommand(config.command).length === 0) {
    return [];
  }
  return config.targets
    .map((target) => target.file)
    .filter((file) => {
      const source = sources?.get(file);
      // Non-function exports cannot be updated through stable wrappers.
      return !source || !/^export\s+(?:const|let|var|class)\b/m.test(source);
    });
}

export async function runHarnessMutation(input: HarnessInput): Promise<RunSummary> {
  const { config, projectRoot, mutants, sources, options, jobs } = input;
  const startedAt = Date.now();
  const tempRoot = path.resolve(projectRoot, config.tempDirName);
  await rm(tempRoot, { recursive: true, force: true });
  const dir = path.join(tempRoot, "worker");
  await mkdir(dir, { recursive: true });
  for (const entry of sandboxEntries) {
    if (
      config.ignorePatterns.some(
        (pattern) => entry === pattern || entry.startsWith(pattern.replace(/\/\*\*$/, "/")),
      )
    ) {
      continue;
    }
    const source = path.join(projectRoot, entry);
    if (existsSync(source)) {
      await cp(source, path.join(dir, entry), { recursive: true });
    }
  }
  await writeFile(path.join(dir, "bunfig.toml"), "");
  symlinkSync(path.join(projectRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  for (const [file, source] of sources) {
    await writeFile(path.join(dir, file), source);
  }
  const harnessPath = path.resolve(import.meta.dir, "harness-runtime.ts");
  const allTestFiles = testFilesFromCommand(config.command);
  for (const file of allTestFiles) {
    const absolute = path.join(dir, "test", file);
    const source = await readFile(absolute, "utf8");
    await writeFile(
      absolute,
      source.replaceAll('from "bun:test"', `from ${JSON.stringify(harnessPath)}`),
    );
  }
  const targets = config.targets.map((target) => target.file);
  for (const target of targets) {
    const baseRel = path.join(path.dirname(target), `.mutbase-${path.basename(target)}`);
    await writeFile(path.join(dir, baseRel), sources.get(target)!);
  }
  const selectedTestFiles = new Map<string, string[]>();
  for (const target of config.targets) {
    const command = input.commandsByTarget.get(target.file) ?? config.command;
    const selected = testFilesFromCommand(command);
    selectedTestFiles.set(target.file, selected.length > 0 ? selected : allTestFiles);
  }

  const childScript = path.resolve(import.meta.dir, "harness-child.ts");
  const startChild = async (worker: number): Promise<Child> => {
    const tmp = path.join(tempRoot, `tmp-${worker}`);
    await mkdir(tmp, { recursive: true });
    const proc = Bun.spawn(["bun", childScript], {
      cwd: dir,
      env: { ...process.env, TMPDIR: tmp, CI_PERF_LINT_TEST_TMP: tmp },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    const pending = new Map<number, (value: { failed: string[] } | "error") => void>();
    let readyResolve: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });
    const decoder = new TextDecoder();
    let buffer = "";
    const handleLine = (line: string): void => {
      let data: { type?: string; runId?: number; failed?: string[] };
      try {
        data = JSON.parse(line);
      } catch {
        return;
      }
      if (data.type === "ready") {
        readyResolve?.();
        return;
      }
      if (typeof data.runId === "number") {
        const resolve = pending.get(data.runId);
        if (resolve) {
          pending.delete(data.runId);
          resolve({ failed: data.failed ?? [] });
        }
      }
    };
    void (async () => {
      for await (const chunk of proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          handleLine(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
        }
      }
      for (const resolve of pending.values()) {
        resolve("error");
      }
      pending.clear();
    })();
    const child: Child = { proc, runId: 0, pending, tmp };
    void proc.stdin.write(
      `${JSON.stringify({ dir, testFiles: allTestFiles, targets, harnessPath })}\n`,
    );
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    const startTimeout = new Promise<never>((_, reject) => {
      startTimer = setTimeout(() => reject(new Error("harness child start timeout")), 60_000);
    });
    try {
      await Promise.race([ready, startTimeout]);
    } finally {
      if (startTimer) {
        clearTimeout(startTimer);
      }
    }
    return child;
  };

  const clearTmp = async (tmp: string): Promise<void> => {
    for (const entry of await readdir(tmp)) {
      await rm(path.join(tmp, entry), { recursive: true, force: true });
    }
  };

  const childStdin = (child: Child): FileSink => child.proc.stdin as FileSink;
  const runOn = (
    child: Child,
    message: Record<string, unknown>,
    timeoutMS: number,
  ): Promise<{ failed: string[] } | "timeout" | "error"> =>
    new Promise((resolve) => {
      const runId = ++child.runId;
      const timer = setTimeout(() => {
        child.pending.delete(runId);
        resolve("timeout");
      }, timeoutMS);
      child.pending.set(runId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      void childStdin(child).write(`${JSON.stringify({ type: "run", ...message, runId })}\n`);
    });

  const children: Child[] = [];
  try {
    for (let worker = 0; worker < jobs; worker += 1) {
      const child = await startChild(worker);
      const baseline = await runOn(
        child,
        { target: targets[0], mutantRel: null, testFiles: allTestFiles },
        120_000,
      );
      if (baseline === "timeout" || baseline === "error" || baseline.failed.length > 0) {
        throw new Error(`Harness baseline failed: ${JSON.stringify(baseline)}`);
      }
      children.push(child);
    }
  } catch (error) {
    for (const child of children) {
      child.proc.kill(9);
    }
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }

  const results: (LocatedMutant | undefined)[] = new Array(mutants.length);
  let cursor = 0;
  let done = 0;
  let failure: unknown;
  const runWorker = async (worker: number): Promise<void> => {
    let child = children[worker]!;
    while (failure === undefined) {
      const index = cursor;
      cursor += 1;
      if (index >= mutants.length) {
        return;
      }
      const mutant = mutants[index]!;
      const mutantRel = path.join(
        path.dirname(mutant.file),
        `.mut-${worker}-${index}-${path.basename(mutant.file)}`,
      );
      const started = Date.now();
      try {
        await writeFile(path.join(dir, mutantRel), applyMutant(sources.get(mutant.file)!, mutant));
        const outcome = await runOn(
          child,
          {
            target: mutant.file,
            mutantRel,
            testFiles: selectedTestFiles.get(mutant.file) ?? allTestFiles,
          },
          config.timeoutMS + 1_000,
        );
        await clearTmp(child.tmp);
        await rm(path.join(dir, mutantRel), { force: true });
        let status: MutantStatus;
        if (outcome === "timeout" || outcome === "error") {
          status = outcome === "timeout" ? "Timeout" : "Killed";
          child.proc.kill(9);
          child = await startChild(worker);
          const baseline = await runOn(
            child,
            { target: targets[0], mutantRel: null, testFiles: allTestFiles },
            120_000,
          );
          if (baseline === "timeout" || baseline === "error" || baseline.failed.length > 0) {
            throw new Error("Harness restart baseline failed");
          }
          children[worker] = child;
        } else if (outcome.failed.length > 0) {
          status = "Killed";
        } else {
          status = "Survived";
        }
        results[index] = {
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
          durationMS: Date.now() - started,
        };
        done += 1;
        options.onProgress?.(done, mutants.length, results[index]);
      } catch (error) {
        failure = error;
        return;
      }
    }
  };
  await Promise.all(children.map((_, worker) => runWorker(worker)));
  for (const child of children) {
    child.proc.kill(9);
  }
  await rm(tempRoot, { recursive: true, force: true });
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
  return {
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
    unsupportedSites: input.unsupportedSites,
    regexSites: input.regexSites,
  };
}
