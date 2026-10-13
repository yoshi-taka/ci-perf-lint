import path from "node:path";
import type { RepositoryScanContext } from "../../repository-scan-context.ts";
import { shellCommandSegments, shellCommands, staticShellWords } from "./command-patterns.ts";

interface GradleCommand {
  directory?: string;
  lifecycle: boolean;
  parallelConfigured: boolean;
  userHome?: string | null;
}

const valueOptions = new Set([
  "-p",
  "--project-dir",
  "-g",
  "--gradle-user-home",
  "-I",
  "--init-script",
  "--project-cache-dir",
  "--max-workers",
  "--console",
  "--warning-mode",
  "--priority",
  "--configuration-cache-problems",
  "-x",
  "--exclude-task",
  "--include-build",
  "--update-locks",
  "--dependency-verification",
  "-F",
  "--write-verification-metadata",
  "-M",
  "--tests",
  "--args",
  "--task",
  "--group",
  "--property",
  "--type",
  "-D",
  "--system-prop",
  "-P",
  "--project-prop",
]);
const booleanOptions = new Set([
  "--build-cache",
  "--no-build-cache",
  "--configuration-cache",
  "--no-configuration-cache",
  "--daemon",
  "--no-daemon",
  "--offline",
  "--continue",
  "--rerun-tasks",
  "--scan",
  "--no-scan",
  "--profile",
  "-q",
  "--quiet",
  "-i",
  "--info",
  "-d",
  "--debug",
  "-w",
  "--warn",
  "-s",
  "--stacktrace",
  "-S",
  "--full-stacktrace",
  "-V",
  "--show-version",
  "-t",
  "--continuous",
  "--refresh-dependencies",
  "-U",
  "--watch-fs",
  "--no-watch-fs",
  "--configure-on-demand",
  "--no-configure-on-demand",
  "--isolated-projects",
  "--no-isolated-projects",
  "--non-interactive",
  "--write-locks",
  "--refresh-keys",
  "--export-keys",
  "--problems-report",
  "--no-problems-report",
  "--rerun",
  "--test-dry-run",
]);
const infoOptions = new Set([
  "--help",
  "-h",
  "-?",
  "--version",
  "-v",
  "--dry-run",
  "-m",
  "--task-graph",
  "--status",
  "--stop",
  "--foreground",
]);

function relativeDirectory(base: string | undefined, value: string): string | undefined {
  if (base === undefined || !value || /[$`]/.test(value) || path.posix.isAbsolute(value)) {
    return undefined;
  }
  const directory = path.posix.normalize(path.posix.join(base, value));
  return directory === ".." || directory.startsWith("../") ? undefined : directory;
}

function parallelSystemProperty(text: string): boolean {
  return /^org\.gradle\.parallel=/.test(text);
}

function configuredJvmOptions(
  environment: Record<string, unknown>,
  directory: string | undefined,
): { parallelConfigured: boolean; userHome?: string | null } {
  let parallelConfigured = false;
  let userHome: string | null | undefined;
  for (const name of ["JAVA_OPTS", "GRADLE_OPTS"]) {
    const value = environment[name];
    if (typeof value !== "string" || !value) {
      continue;
    }
    const words = staticShellWords(value);
    if (!words) {
      parallelConfigured = true;
      continue;
    }
    for (let index = 0; index < words.length; index++) {
      const property =
        words[index] === "-D"
          ? words[++index]
          : words[index]?.startsWith("-D")
            ? words[index]!.slice(2)
            : undefined;
      if (property) {
        parallelConfigured ||= parallelSystemProperty(property);
        if (property.startsWith("gradle.user.home=")) {
          userHome =
            relativeDirectory(directory, property.slice("gradle.user.home=".length)) ?? null;
        }
      }
    }
  }
  return { parallelConfigured, userHome };
}

export function collectGradleCommands(
  text: string,
  environment: Record<string, unknown> = {},
  directory: string | undefined = ".",
): GradleCommand[] {
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
  if (directory) {
    directory = relativeDirectory(".", directory);
  }
  const env = { ...environment };
  const commands: GradleCommand[] = [];
  for (const segment of shellCommandSegments(text)) {
    if (/\$\(|`/.test(segment)) {
      return [];
    }
    const words = shellCommands(segment)[0] ?? [];
    if (words[0] === "cd") {
      const args = words[1] === "--" ? words.slice(2) : words.slice(1);
      directory = args.length === 1 ? relativeDirectory(directory, args[0]!) : undefined;
      continue;
    }
    if (["pushd", "popd", "source", "."].includes(words[0] ?? "")) {
      directory = undefined;
      continue;
    }
    if (words[0] === "export") {
      for (const assignment of words.slice(1)) {
        const match = /^([A-Za-z_]\w*)=(.*)$/.exec(assignment);
        if (match) {
          env[match[1]!] = match[2];
        }
      }
      continue;
    }
    if (words[0] === "unset") {
      for (const name of words.slice(1)) {
        delete env[name];
      }
      continue;
    }
    const localEnv = { ...env };
    let index = words[0] === "env" ? 1 : 0;
    while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
      const assignment = words[index++]!;
      const equals = assignment.indexOf("=");
      localEnv[assignment.slice(0, equals)] = assignment.slice(equals + 1);
    }
    const executable = (words[index++] ?? "").replace(/\\/g, "/").split("/").at(-1);
    if (!/^(?:gradle|gradlew)(?:\.bat)?$/.test(executable ?? "")) {
      continue;
    }
    let projectDirectory = directory;
    const jvmOptions = configuredJvmOptions(localEnv, directory);
    let userHome =
      jvmOptions.userHome === undefined
        ? typeof localEnv.GRADLE_USER_HOME === "string" && localEnv.GRADLE_USER_HOME
          ? (relativeDirectory(directory, localEnv.GRADLE_USER_HOME) ?? null)
          : undefined
        : jvmOptions.userHome;
    let cliUserHome: string | null | undefined;
    let parallelConfigured = jvmOptions.parallelConfigured;
    let lifecycle = false;
    let inactive = false;
    let opaque = false;
    let globalOptions = true;
    for (; index < words.length; index++) {
      const word = words[index]!;
      if (word === "--") {
        globalOptions = false;
        continue;
      }
      const name = word.split("=", 1)[0]!;
      if (globalOptions && (word === "--parallel" || word === "--no-parallel")) {
        parallelConfigured = true;
      } else if (!globalOptions && (word === "--parallel" || word === "--no-parallel")) {
        // These are task options after the delimiter, not project-wide settings.
        continue;
      } else if (globalOptions && infoOptions.has(word)) {
        inactive = true;
      } else if (valueOptions.has(name)) {
        const value = word.includes("=") ? word.slice(word.indexOf("=") + 1) : words[++index];
        if (!value) {
          opaque = true;
        } else if (globalOptions && (name === "-p" || name === "--project-dir")) {
          projectDirectory = relativeDirectory(directory, value);
        } else if (globalOptions && (name === "-g" || name === "--gradle-user-home")) {
          cliUserHome = relativeDirectory(directory, value) ?? null;
        } else if (globalOptions && (name === "-D" || name === "--system-prop")) {
          parallelConfigured ||= parallelSystemProperty(value);
          if (value.startsWith("gradle.user.home=")) {
            userHome =
              relativeDirectory(directory, value.slice("gradle.user.home=".length)) ?? null;
          }
        } else if (globalOptions && (name === "-I" || name === "--init-script")) {
          opaque = true;
        }
      } else if (globalOptions && /^-[DP].+/.test(word)) {
        if (word.startsWith("-D")) {
          const property = word.slice(2);
          parallelConfigured ||= parallelSystemProperty(property);
          if (property.startsWith("gradle.user.home=")) {
            userHome =
              relativeDirectory(directory, property.slice("gradle.user.home=".length)) ?? null;
          }
        }
      } else if (globalOptions && /^-p.+/.test(word)) {
        projectDirectory = relativeDirectory(directory, word.slice(2));
      } else if (globalOptions && /^-g.+/.test(word)) {
        cliUserHome = relativeDirectory(directory, word.slice(2)) ?? null;
      } else if (word.startsWith("-") && !booleanOptions.has(word)) {
        opaque = true;
      } else if (!word.startsWith("-")) {
        const task = word.split(":").at(-1) ?? "";
        lifecycle ||= /^(?:build|check|test|assemble|publish)(?:[A-Z]\w*)?$/.test(task);
        opaque ||= /[$`]/.test(word);
      }
    }
    commands.push({
      directory: projectDirectory,
      lifecycle: lifecycle && !inactive && !opaque,
      parallelConfigured,
      userHome: cliUserHome === undefined ? userHome : cliUserHome,
    });
  }
  return commands;
}

export async function findGradleBuildRoot(
  context: RepositoryScanContext,
  directory: string | undefined,
): Promise<string | undefined> {
  if (
    directory === undefined ||
    path.posix.isAbsolute(directory) ||
    directory === ".." ||
    directory.startsWith("../") ||
    /[$`]/.test(directory)
  ) {
    return undefined;
  }
  let current = path.posix.normalize(directory);
  if (current === ".." || current.startsWith("../")) {
    return undefined;
  }
  let fallback: string | undefined;
  for (;;) {
    if (
      (
        await Promise.all(
          ["settings.gradle", "settings.gradle.kts"].map((name) =>
            context.pathExists(context.resolve(current, name)),
          ),
        )
      ).some(Boolean)
    ) {
      return current;
    }
    if (
      fallback === undefined &&
      (
        await Promise.all(
          ["build.gradle", "build.gradle.kts", "gradlew", "gradlew.bat"].map((name) =>
            context.pathExists(context.resolve(current, name)),
          ),
        )
      ).some(Boolean)
    ) {
      fallback = current;
    }
    if (current === ".") {
      return fallback;
    }
    current = path.posix.dirname(current);
  }
}

export function gradleParallelProperty(
  text: string,
): "enabled" | "disabled" | "unknown" | "absent" {
  let state: "enabled" | "disabled" | "unknown" | "absent" = "absent";
  for (const line of text
    .replace(/^\uFEFF/, "")
    .replace(/\\\r?\n\s*/g, "")
    .split(/\r?\n/)) {
    const match = /^(?:systemProp\.)?org\.gradle\.parallel(?=$|[\s:=])\s*[:=]?\s*(.*)$/.exec(
      line.trim(),
    );
    if (match) {
      const value = match[1]!.trim().toLowerCase();
      state = value === "true" ? "enabled" : value === "false" ? "disabled" : "unknown";
    }
  }
  return state;
}
