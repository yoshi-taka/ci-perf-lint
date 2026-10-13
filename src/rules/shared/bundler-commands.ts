import path from "node:path";
import { shellCommands } from "./command-patterns.ts";

const valueOptions = new Set([
  "--gemfile",
  "--path",
  "--jobs",
  "-j",
  "--retry",
  "--without",
  "--with",
  "--binstubs",
  "--shebang",
  "--trust-policy",
  "--lockfile",
  "--target-rbconfig",
  "--cooldown",
]);
const globalFlags = new Set([
  "--verbose",
  "-V",
  "--no-color",
  "--quiet",
  "--deployment",
  "--frozen",
  "--local",
  "--no-cache",
  "--prefer-local",
  "--full-index",
]);
const infoFlags = new Set(["--help", "-h", "--version", "-v"]);

export function textRunsBundlerInstall(text: string): boolean {
  const commands = shellCommands(text);
  if (
    commands.some((tokens) =>
      tokens.some((token, index) => token === "<" && tokens[index + 1] === "<"),
    )
  ) {
    return false;
  }
  return commands.some((tokens) => {
    let index = tokens[0] === "env" ? 1 : 0;
    while (/^[A-Za-z_]\w*=/.test(tokens[index] ?? "")) {
      index++;
    }
    if (
      /^ruby(?:\d+(?:\.\d+)*)?$/.test(path.posix.basename(tokens[index] ?? "")) &&
      tokens[index + 1] === "-S"
    ) {
      index += 2;
    }
    if (!["bundle", "bundler"].includes(path.posix.basename(tokens[index++] ?? ""))) {
      return false;
    }
    if (/^_[0-9][^\s$`]*_$/.test(tokens[index] ?? "")) {
      index++;
    }
    const args = tokens.slice(index);
    for (let arg = 0; arg < args.length && args[arg] !== "--"; arg++) {
      const name = args[arg]!.split("=", 1)[0]!;
      if (valueOptions.has(name) && !args[arg]!.includes("=")) {
        if (!args[arg + 1]) {
          return false;
        }
        arg++;
      } else if (infoFlags.has(args[arg]!)) {
        return false;
      }
    }
    let action = 0;
    while (args[action]?.startsWith("-") && args[action] !== "--") {
      const option = args[action]!;
      const name = option.split("=", 1)[0]!;
      if (valueOptions.has(name)) {
        action += option.includes("=") ? 1 : 2;
      } else if (globalFlags.has(name) && (option === name || /=(?:true|false)$/.test(option))) {
        action++;
      } else {
        return false;
      }
    }
    if (args[action] === "--") {
      action++;
    }
    // Bundler's default task is install; other tasks and opaque exec bodies are not installs.
    return args[action] === undefined || args[action] === "install";
  });
}
