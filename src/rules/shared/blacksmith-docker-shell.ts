import { shellCommands, shellCommandSegments } from "./command-patterns.ts";
import { shellExecutionTexts } from "./shell-execution-text.ts";
import { shellInvocations } from "./shell-invocations.ts";
import { shellFileRedirectionTargets } from "./repository-command-evidence.ts";

/** Only a cat heredoc writing .env is metadata; input documents for shells are not. */
function withoutEnvHeredocs(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const result: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const opening = /^\s*cat\s+<<(['"]?)([A-Za-z_]\w*)\1\s*>\s*\.env\s*$/.exec(line);
    if (!opening) {
      result.push(line);
      continue;
    }
    const body: string[] = [];
    while (++index < lines.length && lines[index] !== opening[2]) {
      body.push(lines[index]!);
    }
    if (index === lines.length || (!opening[1] && /\$\(|`|\\/.test(body.join("\n")))) {
      return undefined;
    }
  }
  return result.join("\n");
}

/** Bounded metadata-only shell grammar, not a general shell safety proof. */
export function blacksmithShellPreservesBuilder(text: string): boolean {
  const source = withoutEnvHeredocs(text);
  if (source === undefined) {
    return false;
  }
  const execution = shellExecutionTexts(source);
  if (execution.length === 0) {
    return false;
  }
  for (const segment of execution.flatMap(shellCommandSegments)) {
    const targets = shellFileRedirectionTargets(segment);
    if (targets.length === 0) {
      continue;
    }
    const words = shellCommands(segment)[0] ?? [];
    const redirect = words.findIndex((word) => word === ">");
    const args = words.slice(1, redirect);
    const name = args[0]?.split("=", 1)[0] ?? "";
    const writesEnvironment = (targets[0] ?? "").includes("GITHUB_ENV");
    // Unknown expansions/printf formatting could inject more environment lines.
    // Only literal single-line NAME=value writes (plus the known date substitution) qualify.
    if (
      targets.length !== 1 ||
      !/^(?:"?\$(?:GITHUB_ENV|GITHUB_OUTPUT|\{GITHUB_ENV\}|\{GITHUB_OUTPUT\})"?)$/.test(
        targets[0]!,
      ) ||
      words[0] !== "echo" ||
      args.length !== 1 ||
      !/^[A-Za-z_]\w*=/.test(args[0]!) ||
      /[$`\\\r\n]/.test(args[0]!) ||
      (writesEnvironment &&
        (!/^(?:[A-Za-z_]\w*_)?(?:VERSION|TAG|DATE_STAMP|SHA|COMMIT_SHA)$/.test(name) ||
          /^(?:DOCKER|BUILDX|BUILDKIT|BLACKSMITH)_/.test(name)))
    ) {
      return false;
    }
  }
  // Assignments, shell wrappers and unknown command positions are not metadata.
  return shellInvocations(source, false).every(([tool, ...args]) => {
    if (["echo", "printf", "test", "[", "fi", "true", "false"].includes(tool ?? "")) {
      return true;
    }
    return tool === "date" && args.length === 1 && args[0] === "+%Y-%m-%d_%H-%M-%S";
  });
}
