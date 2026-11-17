import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

interface Options {
  manifest: string;
  corpusDir: string;
  outDir: string;
  maxMs: number;
  seed: number;
  maxLength: number;
  stallMs: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    manifest: "",
    corpusDir: "",
    outDir: ".fuzz-work",
    maxMs: 60_000,
    seed: Date.now() >>> 0,
    maxLength: 4096,
    stallMs: 10_000,
  };
  for (const argument of argv) {
    if (argument.startsWith("--max-time=")) {
      options.maxMs = Number(argument.slice("--max-time=".length));
    } else if (argument.startsWith("--seed=")) {
      options.seed = Number(argument.slice("--seed=".length)) >>> 0;
    } else if (argument.startsWith("--max-len=")) {
      options.maxLength = Number(argument.slice("--max-len=".length));
    } else if (argument.startsWith("--stall-ms=")) {
      options.stallMs = Number(argument.slice("--stall-ms=".length));
    } else if (argument.startsWith("--out=")) {
      options.outDir = argument.slice("--out=".length);
    } else if (!options.manifest) {
      options.manifest = argument;
    } else if (!options.corpusDir) {
      options.corpusDir = argument;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.manifest || !options.corpusDir) {
    throw new Error(
      "Usage: bun run src/fuzz/main.ts <manifest.fuzz.mjs> <corpus-dir> [--out=DIR] [--max-time=MS] [--seed=N]",
    );
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const outDir = path.resolve(options.outDir);
const crashesDir = path.join(outDir, "crashes");
await mkdir(crashesDir, { recursive: true });
const currentPath = path.join(outDir, "current.bin");
const deadline = Date.now() + options.maxMs;

let restarts = 0;
let lastProgress = { inputs: 0, coverageKeys: 0, crashes: 0, corpus: 0 };

async function acceptCurrentAsCrash(kind: string): Promise<void> {
  if (!existsSync(currentPath)) {
    return;
  }
  const data = await readFile(currentPath);
  const hash = createHash("sha256").update(data).digest("hex");
  await writeFile(path.join(crashesDir, `${kind}-${hash}`), data);
  lastProgress.crashes += 1;
}

function startWorker(): ReturnType<typeof Bun.spawn> {
  const config = {
    manifest: path.resolve(options.manifest),
    corpusDir: path.resolve(options.corpusDir),
    outDir,
    seed: options.seed + restarts,
    maxMs: Math.max(1, deadline - Date.now()),
    maxLength: options.maxLength,
  };
  return Bun.spawn(["bun", path.resolve(import.meta.dir, "worker.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, FUZZ_CONFIG: JSON.stringify(config) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
}

while (Date.now() < deadline) {
  const worker = startWorker();
  let lastMessageAt = Date.now();
  const state: { completed: boolean } = { completed: false };
  const decoder = new TextDecoder();
  let buffer = "";
  const handleLine = (line: string) => {
    try {
      const message = JSON.parse(line) as {
        type: string;
        inputs: number;
        coverageKeys: number;
        crashes: number;
        corpus: number;
      };
      lastMessageAt = Date.now();
      lastProgress = message;
      if (message.type === "summary") {
        state.completed = true;
      }
    } catch {
      // ignore non-protocol output
    }
  };
  void (async () => {
    for await (const chunk of worker.stdout as ReadableStream<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
  })();
  const monitor = setInterval(async () => {
    if (state.completed) {
      return;
    }
    if (Date.now() - lastMessageAt > options.stallMs) {
      worker.kill(9);
      await acceptCurrentAsCrash("timeout");
      restarts += 1;
      clearInterval(monitor);
    }
  }, 250);
  const code = await worker.exited;
  clearInterval(monitor);
  if (state.completed) {
    break;
  }
  if (Date.now() < deadline) {
    restarts += 1;
    await acceptCurrentAsCrash("crash");
  }
  if (code === 0) {
    break;
  }
}

console.log(
  JSON.stringify({
    ...lastProgress,
    restarts,
    outDir,
    elapsedMs: options.maxMs - Math.max(0, deadline - Date.now()),
  }),
);
