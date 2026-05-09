import { spawn } from "node:child_process";

export const EMBEDDED_OXLINT_TIMEOUT_MS = 5_000;
const MAX_STDOUT_BUFFER_SIZE = 2 * 1024 * 1024;
const MAX_STDERR_BUFFER_SIZE = 1024 * 1024;

type SpawnedProcess = {
  stdout: Promise<string>;
  stderr: Promise<string>;
  exited: Promise<number>;
  timedOut: boolean;
  signaled: boolean;
};

export function spawnOxlintProcess(
  cmd: string[],
  cwd: string,
  _useNodeSpawn?: boolean,
  timeoutMs?: number,
): SpawnedProcess {
  const effectiveTimeout = timeoutMs ?? EMBEDDED_OXLINT_TIMEOUT_MS;
  const state = { timedOut: false };
  const proc = spawn(cmd[0]!, cmd.slice(1), {
    cwd,
    stdio: ["inherit", "pipe", "pipe"],
    detached: true,
  });

  function killProcessGroup(signal: NodeJS.Signals): void {
    const pid = proc.pid;
    if (pid === undefined) {
      return;
    }

    try {
      process.kill(-pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {
        /* ignore */
      }
    }
  }

  const killTimer = setTimeout(() => {
    state.timedOut = true;
    killProcessGroup("SIGTERM");
    setTimeout(() => {
      try {
        killProcessGroup("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 2000).unref();
  }, effectiveTimeout).unref();

  const stdoutPromise = new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    proc.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_STDOUT_BUFFER_SIZE) {
        chunks.push(chunk);
      }
    });
    proc.on("close", () => resolve(Buffer.concat(chunks).toString()));
  });
  const stderrPromise = new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    proc.stderr.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_STDERR_BUFFER_SIZE) {
        chunks.push(chunk);
      }
    });
    proc.on("close", () => resolve(Buffer.concat(chunks).toString()));
  });
  const stateSignaled = { value: false };
  const exitedPromise = new Promise<number>((resolve) => {
    proc.on("close", (code, signal) => {
      clearTimeout(killTimer);
      if (code === null && signal !== null) {
        stateSignaled.value = true;
      }
      resolve(code ?? 1);
    });
  });

  return {
    stdout: stdoutPromise,
    stderr: stderrPromise,
    exited: exitedPromise,
    get timedOut() {
      return state.timedOut;
    },
    get signaled() {
      return stateSignaled.value;
    },
  } satisfies SpawnedProcess;
}
