import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { MemoryOptions, MemoryScenario, MemoryVariant } from "./types.ts";

const exec = promisify(execFile);
interface ProcessRow {
  pid: number;
  parent: number;
  kib: number;
  command: string;
}

export function memoryRows(output: string): ProcessRow[] {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            kib: Number(match[4]),
            command: match[5]!,
          },
        ]
      : [];
  });
}

export function memoryTree(rows: ProcessRow[], root: number): ProcessRow[] {
  const included = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (included.has(row.parent) && !included.has(row.pid)) {
        included.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => included.has(row.pid));
}

export function median(values: number[]): number {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Median requires finite samples");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function treeSamplingLimited(peakTreeKiB: number, osIndividualMaxBytes: number): boolean {
  // Preserve raw samples, but expose misses instead of calling them memory wins.
  return peakTreeKiB * 1024 < osIndividualMaxBytes;
}

export function validateMemoryOutput(
  output: unknown,
  scenario: MemoryScenario,
  variant: MemoryVariant,
  mode: "source" | "cli",
): string {
  if (mode === "cli") {
    if (!Array.isArray(output) || output.some((row) => typeof row?.ruleId !== "string")) {
      throw new Error("CLI output must be a findings array");
    }
    if (variant.backend === "native" && scenario.expected) {
      const count = (id: string) => output.filter((row) => row.ruleId === id).length;
      if (
        count("detected-large-barrel-file") !== scenario.expected.barrels ||
        count("large-jest-snapshot") !== scenario.expected.snapshots ||
        count("prefer-direct-date-fns-imports") !== (scenario.components ?? 0) * 2
      ) {
        throw new Error("CLI skipped or changed an expected scenario finding");
      }
    }
    return variant.backend === "embedded-oxlint"
      ? "legacy-not-equivalent"
      : scenario.expected
        ? "validated"
        : "real-target-unchecked";
  }
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("Source output must be an object");
  }
  const data = output as Record<string, unknown>;
  if (variant.backend === "embedded-oxlint") {
    if (data.returned !== true) {
      throw new Error("Legacy scanner did not return facts");
    }
    return "legacy-not-equivalent";
  }
  if (!Array.isArray(data.warnings)) {
    throw new Error("Missing source warning telemetry");
  }
  for (const key of ["imports", "barrels", "snapshots"]) {
    if (!Number.isSafeInteger(data[key]) || Number(data[key]) < 0) {
      throw new Error(`Invalid ${key} count`);
    }
  }
  if (scenario.expected) {
    for (const [key, count] of Object.entries(scenario.expected)) {
      if (data[key] !== count) {
        throw new Error(`Expected ${count} ${key}, got ${String(data[key])}`);
      }
    }
    if (!scenario.components && data.warnings.length) {
      throw new Error("Config scenario fell back or warned");
    }
  }
  return scenario.expected ? "validated" : "real-target-unchecked";
}

export async function measureMemory(
  context: { repo: string; output: string; options: MemoryOptions },
  scenario: MemoryScenario,
  variant: MemoryVariant,
  mode: "source" | "cli",
  round: number,
) {
  const { repo, output, options } = context;
  const label = `${scenario.name}-${mode}-${variant.label}-${round}`;
  const stdoutFile = path.join(output, `${label}.stdout`);
  const stderrFile = path.join(output, `${label}.stderr`);
  const outFd = openSync(stdoutFile, "wx"),
    errFd = openSync(stderrFile, "wx");
  const env: NodeJS.ProcessEnv = { ...process.env, CI_PERF_LINT_TIMINGS: "1" };
  delete env.CI_PERF_LINT_DISABLE_OXLINT;
  delete env.CI_PERF_LINT_DISABLE_OXLINT_PREWARM;
  const command = [
    options.node,
    path.join(variant.directory, "dist", mode === "source" ? "source-memory.js" : "cli.js"),
    scenario.directory,
    ...(mode === "cli" ? ["--repository-only", "--findings-only", "--format", "json"] : []),
  ];
  const started = performance.now();
  const child = spawn(
    process.execPath,
    [
      "--no-orphans",
      path.join(repo, "scripts/run-bounded.ts"),
      "--memory-mib",
      String(options.memoryMiB),
      "--timeout-ms",
      String(options.timeoutMs),
      "--",
      "/usr/bin/time",
      "-l",
      ...command,
    ],
    { cwd: variant.directory, env, detached: true, stdio: ["ignore", outFd, errFd] },
  );
  let finished = false,
    sampling = false,
    peakTreeKiB = 0,
    workloadPid: number | undefined,
    sampleError: unknown;
  const processes = new Map<number, { pid: number; command: string; peakKiB: number }>();
  const trace: { ms: number; totalKiB: number; members: ProcessRow[] }[] = [];
  const measurementFinished = () => finished;
  const sample = async () => {
    if (measurementFinished() || sampling) {
      return;
    }
    sampling = true;
    try {
      const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,pgid=,rss=,command="], {
        maxBuffer: 2 * 1024 * 1024,
      });
      if (measurementFinished()) {
        return;
      }
      const rows = memoryRows(stdout);
      workloadPid ??= rows.find(
        (row) => row.parent === child.pid && row.command.startsWith("/usr/bin/time "),
      )?.pid;
      if (workloadPid === undefined) {
        return;
      }
      const members = memoryTree(rows, workloadPid);
      const totalKiB = members.reduce((sum, row) => sum + row.kib, 0);
      peakTreeKiB = Math.max(peakTreeKiB, totalKiB);
      for (const row of members) {
        const previous = processes.get(row.pid);
        processes.set(row.pid, {
          pid: row.pid,
          command: row.command,
          peakKiB: Math.max(previous?.peakKiB ?? 0, row.kib),
        });
      }
      trace.push({ ms: performance.now() - started, totalKiB, members });
    } finally {
      sampling = false;
    }
  };
  const timer = setInterval(() => {
    void sample().catch((error) => {
      sampleError = error;
      child.kill("SIGTERM");
    });
  }, 20);
  let code: number;
  try {
    code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (status) => resolve(status ?? -1));
    });
  } finally {
    finished = true;
    clearInterval(timer);
    closeSync(outFd);
    closeSync(errFd);
  }
  const stderr = await Bun.file(stderrFile).text();
  let data: unknown,
    validation = "",
    error: string | undefined;
  try {
    if (sampleError) {
      throw sampleError;
    }
    if (code !== 0 && !(mode === "cli" && code === 1)) {
      throw new Error(`Command exited ${code}`);
    }
    if (
      /RSS .* exceeded|deadline .* exceeded|sampling failed|cleanup .* failed|timed out|Partial results|skipped for/.test(
        stderr,
      )
    ) {
      throw new Error("Guard fired or analysis was visibly incomplete");
    }
    data = await Bun.file(stdoutFile).json();
    validation = validateMemoryOutput(data, scenario, variant, mode);
    if (!trace.length || !peakTreeKiB) {
      throw new Error("No workload RSS samples");
    }
  } catch (failure) {
    error = String(failure);
  }
  const processList = [...processes.values()].sort((a, b) => b.peakKiB - a.peakKiB);
  const oxlintObserved = processList.some((row) =>
    /[\\/]node_modules[\\/](?:oxlint[\\/]|\.bin[\\/]oxlint(?:\s|$))/.test(row.command),
  );
  const executionConfirmed =
    variant.backend === "embedded-oxlint"
      ? oxlintObserved || stderr.includes("[timing] embedded-oxlint time=")
      : !oxlintObserved;
  if (!executionConfirmed) {
    error ??= "Backend execution not confirmed";
  }
  const osIndividualMaxBytes = Number(/(\d+)\s+maximum resident set size/.exec(stderr)?.[1] ?? 0);
  if (!osIndividualMaxBytes) {
    error ??= "Missing OS individual maximum RSS";
  }
  let outputSummary = data;
  if (mode === "cli" && Array.isArray(data)) {
    const countByRule: Record<string, number> = {};
    for (const row of data) {
      if (typeof row?.ruleId === "string") {
        countByRule[row.ruleId] = (countByRule[row.ruleId] ?? 0) + 1;
      }
    }
    outputSummary = { findings: data.length, countByRule };
  }
  await Bun.write(path.join(output, `${label}.trace.json`), JSON.stringify(trace));
  return {
    scenario: scenario.name,
    mode,
    variant: variant.label,
    backend: variant.backend,
    commit: variant.commit,
    round,
    code,
    valid: !error,
    validation,
    error,
    elapsedMs: performance.now() - started,
    peakTreeKiB,
    osIndividualMaxBytes,
    treeSamplingLimited: treeSamplingLimited(peakTreeKiB, osIndividualMaxBytes),
    sampleCount: trace.length,
    sampleIntervalMs: 20,
    processes: processList,
    oxlintObserved,
    shortLivedChildNotIdentified: variant.backend === "embedded-oxlint" && !oxlintObserved,
    output: outputSummary,
    stdoutFile,
    stderrFile,
  };
}
