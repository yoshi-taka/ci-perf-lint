import path from "node:path";
import { shellCommandSegments, shellCommands } from "./command-patterns.ts";

export interface MakeBuildCommand {
  kind: "make" | "cmake" | "cmake-configure";
  text: string;
  directory?: string;
  targets: string[];
  customMakefile: boolean;
  needsParallel: boolean;
  generator?: string;
}

const makeValues = new Set([
  "-f",
  "--file",
  "--makefile",
  "-C",
  "--directory",
  "-I",
  "--include-dir",
  "-o",
  "--old-file",
  "--assume-old",
  "-W",
  "--what-if",
  "--new-file",
  "--assume-new",
  "--eval",
  "-E",
]);
const makeInfo = new Set([
  "--help",
  "--version",
  "--dry-run",
  "--just-print",
  "--recon",
  "--question",
  "--touch",
]);
const shortValues = new Set("fCIoWE");

function resolveDirectory(base: string | undefined, value: string): string | undefined {
  return !value || /[$`]/.test(value)
    ? undefined
    : path.posix.isAbsolute(value)
      ? path.posix.normalize(value)
      : base === undefined
        ? undefined
        : path.posix.normalize(path.posix.join(base, value));
}

function makeArguments(args: string[], directory?: string) {
  let parallel = false;
  let inactive = false;
  let customMakefile = false;
  let options = true;
  const targets: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--" && options) {
      options = false;
      continue;
    }
    if (options && arg.startsWith("-")) {
      const name = arg.split("=", 1)[0]!;
      if (name === "--jobs") {
        parallel = true;
        if (!arg.includes("=") && /^\d+$/.test(args[index + 1] ?? "")) {
          index++;
        }
      } else if (makeValues.has(name)) {
        const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++index];
        if (!value) {
          inactive = true;
        } else if (name === "-C" || name === "--directory") {
          directory = resolveDirectory(directory, value);
        } else if (["-f", "--file", "--makefile"].includes(name)) {
          customMakefile = true;
        } else if (name === "--eval" || name === "-E") {
          customMakefile = true;
          parallel = true;
        }
      } else if (makeInfo.has(name)) {
        inactive = true;
      } else if (!arg.startsWith("--")) {
        for (let position = 1; position < arg.length; position++) {
          const flag = arg[position]!;
          if (flag === "j") {
            parallel = true;
            if (position + 1 === arg.length && /^\d+$/.test(args[index + 1] ?? "")) {
              index++;
            }
            break;
          }
          if ("hnqtv".includes(flag)) {
            inactive = true;
          }
          if (shortValues.has(flag) || flag === "l") {
            const value =
              arg.slice(position + 1) ||
              (flag === "l" && !/^\d/.test(args[index + 1] ?? "") ? undefined : args[++index]);
            if (flag === "C") {
              directory = value ? resolveDirectory(directory, value) : undefined;
            } else if (flag === "f") {
              customMakefile = true;
            } else if (flag === "E") {
              customMakefile = true;
              parallel = true;
            }
            break;
          }
        }
      }
    } else if (/^[A-Za-z_]\w*=/.test(arg)) {
      continue;
    } else if (/[$`]/.test(arg)) {
      // Unresolved argument lists can supply parallel flags.
      parallel = true;
    } else {
      targets.push(arg);
    }
  }
  return { parallel, inactive, customMakefile, directory, targets };
}

function parallelEnvironment(
  kind: "make" | "cmake",
  environment: Record<string, unknown>,
): boolean {
  const value = environment[kind === "make" ? "MAKEFLAGS" : "CMAKE_BUILD_PARALLEL_LEVEL"];
  if (value === undefined || value === null || value === "") {
    return false;
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return true;
  }
  const text = String(value).trim();
  if (kind === "cmake") {
    return /^\d+$/.test(text) || /[$`]/.test(text);
  }
  if (/[$`]/.test(text)) {
    return true;
  }
  const flags = shellCommands(text)[0] ?? [];
  if (flags[0] && !flags[0].startsWith("-") && /^[A-Za-z]+\d*$/.test(flags[0])) {
    flags[0] = `-${flags[0]}`;
  }
  return makeArguments(flags).parallel;
}

const cmakeValues = new Set([
  "--build",
  "--target",
  "-t",
  "--config",
  "--parallel",
  "-j",
  "--preset",
  "-S",
  "-B",
  "-G",
  "-C",
  "--toolchain",
  "--install-prefix",
]);

export function collectMakeBuildCommands(
  text: string,
  environment: Record<string, unknown> = {},
  directory: string | undefined = ".",
): MakeBuildCommand[] {
  const commands = shellCommands(text);
  if (
    commands.some((tokens) =>
      tokens.some((token, index) => token === "<" && tokens[index + 1] === "<"),
    )
  ) {
    return [];
  }
  if (
    commands.some((tokens) =>
      ["if", "then", "else", "elif", "fi", "for", "while", "until", "case", "function"].includes(
        tokens[0] ?? "",
      ),
    )
  ) {
    return [];
  }
  const env = { ...environment };
  const results: MakeBuildCommand[] = [];
  for (const command of shellCommandSegments(text)) {
    const tokens = shellCommands(command)[0] ?? [];
    if (/\$\(|`/.test(command)) {
      if (["cd", "pushd", "popd", "source", ".", "export", "unset"].includes(tokens[0] ?? "")) {
        return [];
      }
      continue;
    }
    if (tokens[0] === "cd") {
      directory = tokens.length === 2 ? resolveDirectory(directory, tokens[1]!) : undefined;
      continue;
    }
    if (["pushd", "popd", "source", "."].includes(tokens[0] ?? "")) {
      directory = undefined;
      continue;
    }
    if (tokens[0] === "export") {
      for (const token of tokens.slice(1)) {
        const assignment = /^([A-Za-z_]\w*)=(.*)$/.exec(token);
        if (assignment) {
          env[assignment[1]!] = assignment[2];
        }
      }
      continue;
    }
    if (tokens[0] === "unset") {
      for (const token of tokens.slice(1)) {
        delete env[token];
      }
      continue;
    }
    const localEnv = { ...env };
    let index = tokens[0] === "env" ? 1 : 0;
    while (/^[A-Za-z_]\w*=/.test(tokens[index] ?? "")) {
      const assignment = tokens[index++]!;
      const equals = assignment.indexOf("=");
      localEnv[assignment.slice(0, equals)] = assignment.slice(equals + 1);
    }
    const executable = path.posix.basename(tokens[index++] ?? "");
    const args = tokens.slice(index);
    if (executable === "make" || executable === "gmake") {
      const parsed = makeArguments(args, directory);
      results.push({
        kind: "make",
        text: command,
        directory: parsed.directory,
        targets: parsed.targets,
        customMakefile: parsed.customMakefile,
        needsParallel:
          !parsed.inactive && !parsed.parallel && !parallelEnvironment("make", localEnv),
      });
    } else if (executable === "cmake") {
      const build = args[0] === "--build" || args[0]?.startsWith("--build=");
      if (
        !build &&
        ["--install", "--open", "--workflow", "-E", "-P", "--find-package"].includes(args[0] ?? "")
      ) {
        continue;
      }
      if (build && args.some((arg) => arg === "--preset" || arg.startsWith("--preset="))) {
        results.push({
          kind: "cmake",
          text: command,
          targets: [],
          customMakefile: false,
          needsParallel: false,
        });
        continue;
      }
      let buildDirectory = directory;
      let generator =
        typeof localEnv.CMAKE_GENERATOR === "string" ? localEnv.CMAKE_GENERATOR : undefined;
      let parallel = parallelEnvironment("cmake", localEnv);
      let inactive = false;
      for (let arg = 0; arg < args.length; arg++) {
        const option = args[arg]!;
        if (option === "--") {
          parallel ||= makeArguments(args.slice(arg + 1)).parallel;
          break;
        }
        const name = option.split("=", 1)[0]!;
        if (["--parallel", "-j"].includes(name) || /^-j\S+$/.test(option)) {
          parallel = true;
          if (!option.includes("=") && /^\d+$/.test(args[arg + 1] ?? "")) {
            arg++;
          }
        } else if (["--help", "-h", "--version"].includes(option)) {
          inactive = true;
        } else if (name === "--preset") {
          parallel = true;
          buildDirectory = undefined;
          if (!option.includes("=")) {
            arg++;
          }
        } else if (cmakeValues.has(name)) {
          const value = option.includes("=") ? option.slice(option.indexOf("=") + 1) : args[++arg];
          if (name === "--build" || name === "-B") {
            buildDirectory = value ? resolveDirectory(directory, value) : undefined;
            inactive ||= name === "--build" && !value;
          } else if (name === "-G") {
            generator = value;
          }
        } else if (/^-B.+$/.test(option)) {
          buildDirectory = resolveDirectory(directory, option.slice(2));
        } else if (/^-G.+$/.test(option)) {
          generator = option.slice(2);
        } else if (/[$`]/.test(option)) {
          parallel = true;
        }
      }
      if (!build && inactive) {
        continue;
      }
      results.push({
        kind: build ? "cmake" : "cmake-configure",
        text: command,
        directory: buildDirectory,
        targets: [],
        customMakefile: false,
        needsParallel: Boolean(build) && !inactive && !parallel,
        generator: inactive ? undefined : generator,
      });
    }
  }
  return results;
}

export function textRunsUntunedMake(text: string): boolean {
  return collectMakeBuildCommands(text).some(
    (command) => command.kind === "make" && command.needsParallel,
  );
}
