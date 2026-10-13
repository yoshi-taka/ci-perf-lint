import {
  hasShellInputDocument,
  shellCommandSegments,
  shellCommands,
  staticShellWords,
} from "./command-patterns.ts";

interface MavenArguments {
  lifecycle: boolean;
  parallelConfigured: boolean;
  opaque: boolean;
  inactive: boolean;
}

const lifecycleGoals = new Set([
  "compile",
  "test",
  "package",
  "verify",
  "install",
  "deploy",
  "integration-test",
]);
const valueOptions = new Set([
  "-D",
  "--define",
  "-P",
  "--activate-profiles",
  "-pl",
  "--projects",
  "-f",
  "--file",
  "-s",
  "--settings",
  "-gs",
  "--global-settings",
  "-t",
  "--toolchains",
  "-gt",
  "--global-toolchains",
  "-rf",
  "--resume-from",
  "-b",
  "--builder",
  "-l",
  "--log-file",
  "-emp",
  "--encrypt-master-password",
  "-ep",
  "--encrypt-password",
]);
const booleanOptions = new Set([
  "-B",
  "--batch-mode",
  "-q",
  "--quiet",
  "-e",
  "--errors",
  "-X",
  "--debug",
  "-V",
  "--show-version",
  "-o",
  "--offline",
  "-U",
  "--update-snapshots",
  "-nsu",
  "--no-snapshot-updates",
  "-N",
  "--non-recursive",
  "-am",
  "--also-make",
  "-amd",
  "--also-make-dependents",
  "-fae",
  "--fail-at-end",
  "-ff",
  "--fail-fast",
  "-fn",
  "--fail-never",
  "-C",
  "--strict-checksums",
  "-c",
  "--lax-checksums",
  "-ntp",
  "--no-transfer-progress",
]);

function parseMavenArguments(words: string[]): MavenArguments {
  let lifecycle = false;
  let parallelConfigured = false;
  let opaque = false;
  let inactive = false;
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    const name = word.split("=", 1)[0]!;
    if (word === "--") {
      // Remaining tokens are goals, not global settings.
      lifecycle ||= words.slice(index + 1).some((goal) => lifecycleGoals.has(goal));
      break;
    }
    if (name === "-T" || name === "--threads" || /^-T.+/.test(word)) {
      const value =
        name === "-T" || name === "--threads"
          ? word.includes("=")
            ? word.slice(word.indexOf("=") + 1)
            : words[++index]
          : word.slice(2);
      if (value && /^(?:\d+(?:\.\d+)?|\.\d+)C?$/.test(value)) {
        parallelConfigured = true;
      } else {
        opaque = true;
      }
    } else if (valueOptions.has(name)) {
      const value = word.includes("=") ? word.slice(word.indexOf("=") + 1) : words[++index];
      opaque ||= !value;
    } else if (/^-(?:D|P).+/.test(word)) {
      // Attached system properties and profiles are values, not lifecycle goals or thread flags.
      continue;
    } else if (["-h", "--help", "-v", "--version"].includes(word)) {
      inactive = true;
    } else if (word.startsWith("-") && !booleanOptions.has(word)) {
      opaque = true;
    } else if (lifecycleGoals.has(word)) {
      lifecycle = true;
    }
  }
  return { lifecycle, parallelConfigured, opaque, inactive };
}

export function mavenConfiguresThreads(text: string): boolean | undefined {
  const words = staticShellWords(text.replace(/^\s*#.*$/gm, "").replace(/\r?\n/g, " "));
  if (!words) {
    return undefined;
  }
  const parsed = parseMavenArguments(words);
  return parsed.opaque ? undefined : parsed.parallelConfigured;
}

export function collectMavenCommands(
  text: string,
  environment: Record<string, unknown> = {},
): MavenArguments[] {
  if (
    /\$\(|`/.test(text) ||
    hasShellInputDocument(text) ||
    shellCommands(text).some((words) =>
      [
        "if",
        "then",
        "else",
        "for",
        "while",
        "until",
        "case",
        "function",
        "export",
        "unset",
        "source",
        ".",
      ].includes(words[0] ?? ""),
    )
  ) {
    return [];
  }
  const commands: MavenArguments[] = [];
  for (const segment of shellCommandSegments(text)) {
    const words = staticShellWords(segment);
    if (!words) {
      continue;
    }
    const localEnv = { ...environment };
    let index = words[0] === "env" ? 1 : 0;
    while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
      const assignment = words[index++]!;
      const equals = assignment.indexOf("=");
      localEnv[assignment.slice(0, equals)] = assignment.slice(equals + 1);
    }
    if (
      !/^(?:mvn|mvnw)(?:\.cmd)?$/.test(
        (words[index++] ?? "").replace(/\\/g, "/").split("/").at(-1) ?? "",
      )
    ) {
      continue;
    }
    const inherited =
      typeof localEnv.MAVEN_ARGS === "string" ? staticShellWords(localEnv.MAVEN_ARGS) : [];
    if (!inherited) {
      continue;
    }
    commands.push(parseMavenArguments([...inherited, ...words.slice(index)]));
  }
  return commands;
}
