import { hasShellInputDocument, shellCommands } from "./command-patterns.ts";
import { shellExecutionTexts } from "./shell-execution-text.ts";

/** Command-position words, not tool names found in arguments or step labels. */
export function shellInvocations(text: string, unwrapTools = true): string[][] {
  if (hasShellInputDocument(text)) {
    return [];
  }
  return shellExecutionTexts(text)
    .flatMap((source) => shellCommands(source))
    .flatMap((words) => {
      let index = 0;
      while (
        ["if", "then", "elif", "else", "while", "until", "do", "!", "{"].includes(
          words[index] ?? "",
        )
      ) {
        index++;
      }
      if (words[index] === "env") {
        index++;
      }
      while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
        index++;
      }
      if (words[index] === "sudo") {
        index++;
        if (words[index] === "-n") {
          index++;
        }
        while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
          index++;
        }
      }
      while (
        ["command", "exec", "nohup", "time"].includes(words[index] ?? "") &&
        words[index + 1] &&
        !words[index + 1]!.startsWith("-")
      ) {
        index++;
      }
      const runner = words[index];
      if (!unwrapTools) {
        return words.length > index ? [words.slice(index)] : [];
      }
      if (["npx", "pnpx", "bunx", "uvx"].includes(runner ?? "")) {
        index++;
        while (["--yes", "-y", "--no-install", "--"].includes(words[index] ?? "")) {
          index++;
        }
      } else if (
        ["pnpm", "yarn", "bun"].includes(runner ?? "") &&
        ["exec", "dlx", "run", "x"].includes(words[index + 1] ?? "")
      ) {
        index += 2;
      } else if (runner === "uv" && words[index + 1] === "run") {
        index += 2;
      } else if (runner === "uv" && words[index + 1] === "tool" && words[index + 2] === "run") {
        index += 3;
      } else if (/^python(?:3(?:\.\d+)?)?$/.test(runner ?? "") && words[index + 1] === "-m") {
        index += 2;
      }
      const command = words.slice(index);
      return command.length && !command[0]!.startsWith("-") ? [command] : [];
    });
}
