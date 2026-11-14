import os from "node:os";
import path from "node:path";
import type { MemoryOptions } from "./types.ts";

const numeric = {
  "--runs": ["runs", 1, 10],
  "--components": ["components", 1, 10_000],
  "--projects": ["projects", 1, 500],
  "--memory-mib": ["memoryMiB", 32, 1792],
  "--timeout-ms": ["timeoutMs", 1000, 120_000],
} as const;

export function parseMemoryOptions(args: string[], cwd = process.cwd()): MemoryOptions {
  const options: MemoryOptions = {
    before: "HEAD^",
    after: "HEAD",
    runs: 3,
    components: 600,
    projects: 128,
    memoryMiB: 1536,
    timeoutMs: 30_000,
    node: "node",
    workDir: os.tmpdir(),
    outputDir: path.resolve(cwd, "artifacts/source-memory"),
    help: false,
  };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === "--") {
      continue;
    }
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    if (seen.has(flag)) {
      throw new Error(`Duplicate option: ${flag}`);
    }
    seen.add(flag);
    const value = args[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (Object.hasOwn(numeric, flag)) {
      const [key, min, max] = numeric[flag as keyof typeof numeric];
      const number = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
        throw new Error(`${flag} must be an integer from ${min} to ${max}`);
      }
      options[key] = number;
      continue;
    }
    switch (flag) {
      case "--before":
        options.before = value;
        break;
      case "--after":
        options.after = value;
        break;
      case "--node":
        options.node = value;
        break;
      case "--work-dir":
        options.workDir = path.resolve(cwd, value);
        break;
      case "--output-dir":
        options.outputDir = path.resolve(cwd, value);
        break;
      case "--target":
        options.target = path.resolve(cwd, value);
        break;
      case "--cases":
        options.cases = value.split(",");
        if (
          options.cases.some((name) => !name) ||
          new Set(options.cases).size !== options.cases.length
        ) {
          throw new Error("--cases requires distinct, nonempty names");
        }
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.target && options.cases) {
    throw new Error("--target and --cases cannot be combined");
  }
  return options;
}

export function assertOutsideTarget(directory: string, target: string): void {
  const relative = path.relative(target, directory);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    throw new Error("Benchmark work/output directories must be outside the target repository");
  }
}
