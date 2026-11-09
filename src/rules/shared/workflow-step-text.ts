import { toolInvocations } from "./tool-command-evidence.ts";
import { repositoryCommandHead } from "./repository-command-evidence.ts";

const taskRunners = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "pip3",
  "pipenv",
  "poetry",
  "uv",
  "bundle",
  "bundler",
  "cargo",
  "go",
  "dotnet",
  "gradle",
  "gradlew",
  "mvn",
  "mvnw",
  "make",
  "just",
  "task",
  "mix",
  "docker",
  "nx",
  "turbo",
  "cmake",
  "bazel",
  "bazelisk",
  "node",
  "python",
  "python3",
  "bash",
  "sh",
]);
const nonWorkCommands = new Set([
  "grep",
  "egrep",
  "fgrep",
  "[",
  "[[",
  "test",
  "true",
  "false",
  "exit",
  "fi",
  "then",
  "else",
  "do",
  "done",
  "}",
  "set",
]);

/** Work identities, not arbitrary arguments (cat 'build notes' is only cat). */
export function workflowCommandWorkText(text: string): string {
  return toolInvocations(text)
    .map((words) => {
      const [tool = "", action, task] = repositoryCommandHead(words);
      if (nonWorkCommands.has(tool)) {
        return "";
      }
      if (!taskRunners.has(tool)) {
        return tool;
      }
      const count = tool === "npm" && ["run", "run-script"].includes(action ?? "") ? 3 : 2;
      return [tool, action, task].slice(0, count).filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
