import path from "node:path";
import {
  parseBootstrapInvocation,
  shellCommandSegments,
  shellCommands,
} from "./command-patterns.ts";

export type TestTool = "jest" | "vitest" | "playwright" | "pytest";
export interface TestWorkerCommand {
  tool: TestTool;
  tuned: boolean;
  config?: string | null;
  configOverridden: boolean;
  directory?: string;
}

const valueOptions: Record<TestTool, ReadonlySet<string>> = {
  jest: new Set([
    "--config",
    "-c",
    "--testNamePattern",
    "-t",
    "--testPathPattern",
    "--testPathPatterns",
    "--testPathIgnorePatterns",
    "--testMatch",
    "--testRegex",
    "--testEnvironment",
    "--testEnvironmentOptions",
    "--coverageDirectory",
    "--outputFile",
    "--reporters",
    "--projects",
    "--selectProjects",
    "--ignoreProjects",
    "--shard",
  ]),
  vitest: new Set([
    "--config",
    "-c",
    "--testNamePattern",
    "-t",
    "--project",
    "--reporter",
    "--outputFile",
    "--testTimeout",
    "--hookTimeout",
    "--environment",
    "--coverage.reportsDirectory",
    "--shard",
  ]),
  playwright: new Set([
    "--config",
    "-c",
    "--grep",
    "-g",
    "--grep-invert",
    "--project",
    "--reporter",
    "--output",
    "--browser",
    "--retries",
    "--repeat-each",
    "--max-failures",
    "--timeout",
    "--shard",
  ]),
  pytest: new Set([
    "-c",
    "--rootdir",
    "-k",
    "-m",
    "--maxfail",
    "--basetemp",
    "--junitxml",
    "--junit-xml",
    "--dist",
    "--max-worker-restart",
    "--maxprocesses",
    "--ignore",
    "--deselect",
    "--import-mode",
    "-o",
    "--override-ini",
  ]),
};
const tuningOptions: Record<TestTool, ReadonlySet<string>> = {
  jest: new Set(["--maxWorkers", "-w"]),
  vitest: new Set([
    "--maxWorkers",
    "--minWorkers",
    "--pool",
    "--poolOptions.threads.maxThreads",
    "--poolOptions.threads.minThreads",
    "--poolOptions.forks.maxForks",
    "--poolOptions.forks.minForks",
  ]),
  playwright: new Set(["--workers", "-j"]),
  pytest: new Set(["-n", "--numprocesses"]),
};

interface WorkerArguments {
  tuned: boolean;
  config?: string | null;
  configOverridden: boolean;
  inactive: boolean;
  opaque: boolean;
}

function parseArguments(tool: TestTool, args: string[]): WorkerArguments {
  let workers = false;
  let inlineWorkers = false;
  let overrideWorkers = false;
  let serialized = false;
  let inactive = false;
  let opaque = false;
  let config: string | null | undefined;
  let configOverridden = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      break;
    }
    const attachedOverride = tool === "pytest" && /^-o.+/.test(arg);
    const name = attachedOverride ? "-o" : arg.split("=", 1)[0]!;
    if (tool === "jest" && ["--runInBand", "--no-runInBand", "-i"].includes(name)) {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : ["true", "false"].includes(args[index + 1] ?? "")
          ? args[++index]
          : undefined;
      serialized = name !== "--no-runInBand" && value !== "false";
    } else if (
      tool === "vitest" &&
      ["--fileParallelism", "--no-file-parallelism", "--no-fileParallelism"].includes(name)
    ) {
      workers = true;
    } else if (tuningOptions[tool].has(name)) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++index];
      if (value && !value.startsWith("-")) {
        workers = true;
      }
    } else if (
      (tool === "pytest" && /^-n(?:\d+|auto|logical)$/.test(arg)) ||
      (tool === "jest" && /^-w\S+$/.test(arg)) ||
      (tool === "playwright" && /^-j\S+$/.test(arg))
    ) {
      workers = true;
    } else if (valueOptions[tool].has(name) || (name === "--config" && tool !== "pytest")) {
      const value = attachedOverride
        ? arg.slice(2)
        : arg.includes("=")
          ? arg.slice(arg.indexOf("=") + 1)
          : args[++index];
      if (name === "--config" || name === "-c") {
        inlineWorkers = false;
        config = value ?? null;
        if (value && /[$`]/.test(value)) {
          opaque = true;
        } else if (tool === "jest" && value?.trim().startsWith("{")) {
          config = null;
          try {
            const inline: unknown = JSON.parse(value);
            inlineWorkers = Boolean(
              inline &&
              typeof inline === "object" &&
              "maxWorkers" in inline &&
              inline.maxWorkers !== undefined &&
              inline.maxWorkers !== null,
            );
          } catch {
            opaque = true;
          }
        }
      } else if (
        tool === "pytest" &&
        (name === "-o" || name === "--override-ini") &&
        value?.startsWith("addopts=")
      ) {
        configOverridden = true;
        const nested = shellCommands(value.slice("addopts=".length))[0] ?? [];
        overrideWorkers = parseArguments("pytest", nested).tuned;
      }
    } else if (/^-c.+$/.test(arg)) {
      inlineWorkers = false;
      config = arg.slice(2);
      opaque ||= /[$`]/.test(config);
    } else if (
      ["--help", "-h", "--version", "--list", "--listTests", "--collect-only", "--co"].includes(arg)
    ) {
      inactive = true;
    } else if (/[$`]/.test(arg)) {
      opaque = true;
    }
  }
  return {
    tuned: workers || serialized || inlineWorkers || overrideWorkers,
    config,
    configOverridden,
    inactive,
    opaque,
  };
}

export function collectTestWorkerCommands(
  text: string,
  environment: Record<string, unknown> = {},
  directory: string | undefined = ".",
): TestWorkerCommand[] {
  const sequences = shellCommands(text);
  if (
    sequences.some(
      (words) =>
        words.some((word, index) => word === "<" && words[index + 1] === "<") ||
        ["if", "then", "else", "for", "while", "until", "case", "function"].includes(
          words[0] ?? "",
        ),
    )
  ) {
    return [];
  }
  const env = { ...environment };
  const commands: TestWorkerCommand[] = [];
  for (const segment of shellCommandSegments(text)) {
    if (/\$\(|`/.test(segment)) {
      return [];
    }
    const original = shellCommands(segment)[0] ?? [];
    if (original[0] === "cd") {
      const args = original[1] === "--" ? original.slice(2) : original.slice(1);
      directory =
        directory !== undefined && args.length === 1 && !/[$`]/.test(args[0]!)
          ? path.posix.isAbsolute(args[0]!)
            ? path.posix.normalize(args[0]!)
            : path.posix.normalize(path.posix.join(directory, args[0]!))
          : undefined;
      continue;
    }
    if (["pushd", "popd", "source", "."].includes(original[0] ?? "")) {
      directory = undefined;
      continue;
    }
    if (original[0] === "export") {
      for (const arg of original.slice(1)) {
        const assignment = /^([A-Za-z_]\w*)=(.*)$/.exec(arg);
        if (assignment) {
          env[assignment[1]!] = assignment[2];
        }
      }
      continue;
    }
    if (original[0] === "unset") {
      for (const name of original.slice(1)) {
        delete env[name];
      }
      continue;
    }
    const words = shellCommands(parseBootstrapInvocation(segment)?.command ?? segment)[0] ?? [];
    const localEnv = { ...env };
    let index = words[0] === "env" ? 1 : 0;
    while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
      const assignment = words[index++]!;
      const equals = assignment.indexOf("=");
      localEnv[assignment.slice(0, equals)] = assignment.slice(equals + 1);
    }
    if (["pnpm", "yarn"].includes(words[index] ?? "") && words[index + 1] === "exec") {
      index += 2;
    } else if (words[index] === "uv" && words[index + 1] === "run") {
      index += 2;
    }
    if (/^python(?:3(?:\.\d+)*)?$/.test(path.posix.basename(words[index] ?? ""))) {
      index++;
      while (/^-(?:I|u|s|S|E|B)$/.test(words[index] ?? "")) {
        index++;
      }
      if (words[index++] !== "-m" || words[index++] !== "pytest") {
        continue;
      }
      index--;
    }
    const executable = path.posix.basename(words[index++] ?? "");
    if (!["jest", "vitest", "playwright", "pytest"].includes(executable)) {
      continue;
    }
    const tool = executable as TestTool;
    if (tool === "playwright" && words[index++] !== "test") {
      continue;
    }
    const inherited =
      tool === "pytest" && typeof localEnv.PYTEST_ADDOPTS === "string"
        ? (shellCommands(localEnv.PYTEST_ADDOPTS)[0] ?? [])
        : [];
    const parsed = parseArguments(tool, [...inherited, ...words.slice(index)]);
    if (!parsed.inactive && !parsed.opaque && directory !== undefined && !/[$`]/.test(directory)) {
      commands.push({
        tool,
        tuned: parsed.tuned,
        config: parsed.config,
        configOverridden: parsed.configOverridden,
        directory,
      });
    }
  }
  return commands;
}
