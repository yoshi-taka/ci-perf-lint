import { repositoryInvocations, repositoryCommandHead } from "./repository-command-evidence.ts";
import { shellExecutionTexts } from "./shell-execution-text.ts";
import { parseBootstrapInvocation, shellCommandSegments } from "./command-patterns.ts";
import { shellNonDisplayInvocations } from "./shell-invocations.ts";

const commonValueOptions = [
  "--config",
  "-c",
  "--project",
  "-p",
  "--output",
  "-o",
  "--cwd",
  "-C",
  "--filter",
  "--label",
  "--message",
  "--testNamePattern",
  "--testPathPattern",
  "--testPathPatterns",
  "--grep",
  "-k",
];

/** Option ownership within one invocation. Values and operands after -- are not flags. */
export function invocationOptions(
  words: string[],
  valueOptions: readonly string[] = [],
): { name: string; value?: string; index: number }[] {
  const valued = new Set([...commonValueOptions, ...valueOptions]);
  const options: { name: string; value?: string; index: number }[] = [];
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!;
    const optionIndex = index;
    if (word === "--") {
      break;
    }
    if (!word.startsWith("-")) {
      continue;
    }
    const equals = word.indexOf("=");
    let name = equals > 0 ? word.slice(0, equals) : word;
    let value = equals > 0 ? word.slice(equals + 1) : undefined;
    if (!word.startsWith("--") && name.length > 2) {
      const short = name.slice(0, 2);
      if (valued.has(short)) {
        name = short;
        value = word.slice(2).replace(/^=/, "");
      }
    }
    if (valued.has(name) && value === undefined) {
      value = words[++index];
    }
    options.push(
      value === undefined ? { name, index: optionIndex } : { name, value, index: optionIndex },
    );
  }
  return options;
}

export function invocationOperands(
  words: string[],
  valueOptions: readonly string[] = [],
): string[] {
  const ignored = new Set<number>();
  for (const option of invocationOptions(words, valueOptions)) {
    ignored.add(option.index);
    if (option.value !== undefined && words[option.index] === option.name) {
      ignored.add(option.index + 1);
    }
  }
  return words.slice(1).filter((word, index) => word !== "--" && !ignored.has(index + 1));
}

export function toolInvocations(text: string): string[][] {
  const bootstrap = shellExecutionTexts(text)
    .flatMap(shellCommandSegments)
    .flatMap((segment) => {
      const invocation = parseBootstrapInvocation(segment);
      return invocation ? shellNonDisplayInvocations(invocation.command, true) : [];
    });
  const commands = [...repositoryInvocations(text), ...bootstrap];
  return [...new Map(commands.map((words) => [JSON.stringify(words), words])).values()];
}

export function textRunsTool(text: string, tool: string, tasks?: readonly string[]): boolean {
  return toolInvocations(text).some((words) => {
    const [name, action] = repositoryCommandHead(words);
    if (name !== tool && !name?.startsWith(`${tool}@`)) {
      return false;
    }
    if (
      invocationOptions(words).some(({ name: option }) =>
        ["--help", "-h", "--version", "-V"].includes(option),
      )
    ) {
      return false;
    }
    return !tasks || tasks.includes(action ?? "");
  });
}
