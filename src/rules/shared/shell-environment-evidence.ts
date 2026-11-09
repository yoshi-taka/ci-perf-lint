import { shellCommands, shellCommandSegments } from "./command-patterns.ts";
import { shellExecutionTexts } from "./shell-execution-text.ts";
import { shellFileRedirectionTargets } from "./repository-command-evidence.ts";

function writesGithubEnvironment(text: string): boolean {
  let quote = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "\\" && quote !== "'") {
      index++;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char !== ">") {
      continue;
    }
    let start = index;
    while (start > 0 && /\d/.test(text[start - 1]!)) {
      start--;
    }
    const descriptor = text.slice(start, index);
    if (descriptor && (start === 0 || /\s/.test(text[start - 1]!)) && descriptor !== "1") {
      while (text[index + 1] === ">") {
        index++;
      }
      continue;
    }
    while (text[index + 1] === ">") {
      index++;
    }
    const target = text.slice(index + 1).trimStart();
    if (
      /^(?:"\$(?:GITHUB_ENV|\{GITHUB_ENV\})"|\$(?:GITHUB_ENV|\{GITHUB_ENV\}))(?=\s|$)/.test(target)
    ) {
      return true;
    }
  }
  return false;
}

/** Assignments and actual GITHUB_ENV writes, not version names printed in a log. */
export function declaredShellEnvironmentNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const source of shellExecutionTexts(text)) {
    for (const segment of shellCommandSegments(source)) {
      const words = shellCommands(segment)[0] ?? [];
      let index = ["export", "env", "readonly"].includes(words[0] ?? "") ? 1 : 0;
      for (; index < words.length; index++) {
        const match = /^([A-Za-z_]\w*)=/.exec(words[index]!);
        if (!match) {
          break;
        }
        names.add(match[1]!);
      }
      if (!["echo", "printf"].includes(words[0] ?? "")) {
        continue;
      }
      if (!writesGithubEnvironment(segment)) {
        continue;
      }
      const redirect = words.findIndex((word) => word === ">");
      if (redirect < 0) {
        continue;
      }
      let targetIndex = redirect + 1;
      if (words[targetIndex] === ">") {
        targetIndex++;
      }
      if (!["$GITHUB_ENV", "${GITHUB_ENV}"].includes(words[targetIndex] ?? "")) {
        continue;
      }
      for (const word of words.slice(1, redirect)) {
        for (const line of word.split(/\r?\n/)) {
          const match = /^([A-Za-z_]\w*)=/.exec(line);
          if (match) {
            names.add(match[1]!);
          }
        }
      }
    }
  }
  return names;
}

/** Literal assignment values only; printf substitutions and expansions remain unresolved. */
export function declaredShellEnvironmentValues(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const source of shellExecutionTexts(text)) {
    for (const segment of shellCommandSegments(source)) {
      const names = declaredShellEnvironmentNames(segment);
      const words = shellCommands(segment)[0] ?? [];
      let index = ["export", "env", "readonly"].includes(words[0] ?? "") ? 1 : 0;
      const assignments: string[] = [];
      while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
        assignments.push(words[index++]!);
      }
      if (["echo", "printf"].includes(words[0] ?? "") && writesGithubEnvironment(segment)) {
        const redirect = words.findIndex((word) => word === ">");
        if (redirect >= 0) {
          assignments.push(...words.slice(1, redirect).flatMap((word) => word.split(/\r?\n/)));
        }
      }
      for (const word of assignments) {
        const match = /^([A-Za-z_]\w*)=(.*)$/.exec(word);
        if (match && names.has(match[1]!) && !/[$`%]|__shell_substitution__/.test(match[2]!)) {
          values[match[1]!] = match[2]!;
        }
      }
    }
  }
  return values;
}

export function githubEnvironmentValues(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const segment of shellExecutionTexts(text).flatMap(shellCommandSegments)) {
    if (
      shellFileRedirectionTargets(segment).some((target) =>
        ["$GITHUB_ENV", "${GITHUB_ENV}", '"$GITHUB_ENV"', '"${GITHUB_ENV}"'].includes(target),
      )
    ) {
      Object.assign(values, declaredShellEnvironmentValues(segment));
    }
  }
  return values;
}
