import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const psArgs = ["-axo", "pid=,ppid=,pgid=,rss=,lstart="];
interface ProcessSample {
  pid: number;
  parent: number;
  group: number;
  kib: number;
  started: string;
}

function processSamples(output: string): ProcessSample[] {
  const rows: ProcessSample[] = [];
  for (const line of output.trim().split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (
      ![4, 9].includes(fields.length) ||
      !fields.slice(0, 4).every((field) => /^\d+$/.test(field))
    ) {
      if (line.trim()) {
        throw new Error("Invalid ps memory sample");
      }
      continue;
    }
    rows.push({
      pid: Number(fields[0]),
      parent: Number(fields[1]),
      group: Number(fields[2]),
      kib: Number(fields[3]),
      started: fields.slice(4).join(" "),
    });
  }
  return rows;
}

function descendants(rows: ProcessSample[], root: number, retained: readonly number[] = []) {
  const included = new Set([
    root,
    ...retained,
    ...rows.filter((row) => row.group === root).map((row) => row.pid),
  ]);
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

/** Include detached worker descendants, plus orphaned members of our process group. */
export function treeResidentKiB(output: string, root: number): number {
  return descendants(processSamples(output), root).reduce((total, row) => total + row.kib, 0);
}

export async function runBounded(
  command: string[],
  memoryMiB: number,
  timeoutMs: number,
): Promise<number> {
  if (
    !command.length ||
    !Number.isSafeInteger(memoryMiB) ||
    memoryMiB < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new Error("Expected positive memory/timeout limits and a command");
  }
  if (process.platform === "win32") {
    throw new Error("Bounded test execution currently requires POSIX process groups and ps");
  }
  // Verify the sampler before launching work; never silently run without the guard.
  await exec("ps", psArgs, { maxBuffer: 2 * 1024 * 1024 });
  const child = spawn(command[0]!, command.slice(1), { detached: true, stdio: "inherit" });
  let failure = 0;
  let peakKiB = 0;
  let sampling = false;
  let finished = false;
  const observed = new Map<number, ProcessSample>();
  const track = (rows: ProcessSample[]) => {
    const live = new Map(rows.map((row) => [row.pid, row]));
    for (const [pid, previous] of observed) {
      const current = live.get(pid);
      if (!current || current.started !== previous.started || current.group !== previous.group) {
        observed.delete(pid); // Do not signal a reused PID.
      }
    }
    const members = descendants(rows, child.pid!, [...observed.keys()]);
    for (const member of members) {
      observed.set(member.pid, member);
    }
    return members;
  };
  const killGroup = () => {
    if (!child.pid) {
      return;
    }
    // Bun test workers can change process groups. Kill observed descendants BEFORE
    // their parent; --no-orphans alone cannot interrupt a worker's microtask storm.
    try {
      const rows = processSamples(
        execFileSync("ps", psArgs, { encoding: "utf8", timeout: 1000, maxBuffer: 2 * 1024 * 1024 }),
      );
      for (const member of track(rows).reverse()) {
        if (member.pid === child.pid) {
          continue;
        }
        try {
          process.kill(member.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
            console.error(`[bounded] child cleanup failed: ${String(error)}`);
            failure ||= 125;
          }
        }
      }
    } catch (error) {
      console.error(`[bounded] cleanup sampling failed: ${String(error)}`);
      failure ||= 125;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  };
  const stop = (code: number, reason: string) => {
    if (failure) {
      return;
    }
    failure = code;
    console.error(`[bounded] ${reason}; terminating process group ${child.pid}.`);
    killGroup();
  };
  const sample = async () => {
    if (sampling || failure || finished) {
      return;
    }
    sampling = true;
    try {
      const { stdout } = await exec("ps", psArgs, {
        maxBuffer: 2 * 1024 * 1024,
      });
      if (finished) {
        return;
      }
      const resident = track(processSamples(stdout)).reduce((total, row) => total + row.kib, 0);
      peakKiB = Math.max(peakKiB, resident);
      if (resident > memoryMiB * 1024) {
        stop(137, `RSS ${Math.ceil(resident / 1024)} MiB exceeded ${memoryMiB} MiB`);
      }
    } catch (error) {
      stop(125, `memory sampling failed: ${String(error)}`);
    } finally {
      sampling = false;
    }
  };
  const signals = {
    SIGINT: () => stop(130, "interrupted"),
    SIGTERM: () => stop(143, "terminated"),
    SIGHUP: () => stop(129, "hangup"),
  };
  for (const [signal, handler] of Object.entries(signals)) {
    process.on(signal, handler);
  }
  const timer = setInterval(() => {
    void sample();
  }, 100);
  const deadline = setTimeout(() => stop(124, `deadline ${timeoutMs} ms exceeded`), timeoutMs);
  let code = 1;
  try {
    code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      // Do not wait on inherited output pipes held by grandchildren.
      child.once("exit", (status, signal) => resolve(status ?? (signal ? 128 : 1)));
    });
  } finally {
    finished = true;
    clearInterval(timer);
    clearTimeout(deadline);
    for (const [signal, handler] of Object.entries(signals)) {
      process.off(signal, handler);
    }
    killGroup(); // Also clean grandchildren when the command exits normally.
    console.error(`[bounded] sampled peak group RSS ${Math.ceil(peakKiB / 1024)} MiB.`);
  }
  return failure || code;
}

if (import.meta.main) {
  const [memoryFlag, memory, timeoutFlag, timeout, separator, ...command] = process.argv.slice(2);
  if (memoryFlag !== "--memory-mib" || timeoutFlag !== "--timeout-ms" || separator !== "--") {
    console.error("Usage: bun scripts/run-bounded.ts --memory-mib N --timeout-ms N -- command ...");
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = await runBounded(command, Number(memory), Number(timeout));
    } catch (error) {
      console.error(`[bounded] ${String(error)}`);
      process.exitCode = 125;
    }
  }
}
