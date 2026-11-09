import { shellExecutionTexts } from "./shell-execution-text.ts";
import { shellNonDisplayInvocations } from "./shell-invocations.ts";
import { invocationWorkName } from "./tooling-command-evidence.ts";

const globalValueOptions = new Set([
  "-C",
  "--cwd",
  "--dir",
  "--directory",
  "--prefix",
  "--filter",
  "-F",
  "--workspace",
  "-w",
  "--registry",
  "--cache",
  "--cache-dir",
  "--cache-folder",
  "--git-dir",
  "--work-tree",
  "-c",
  "--config-env",
  "--namespace",
  "--super-prefix",
]);

function commandActionIndex(words: string[]): number | undefined {
  let index = 1;
  while (words[index]?.startsWith("-")) {
    const word = words[index++]!;
    if (word === "--") {
      break;
    }
    if (globalValueOptions.has(word)) {
      index++;
    } else if (
      !word.includes("=") &&
      ![
        "--silent",
        "--quiet",
        "-q",
        "--verbose",
        "-v",
        "--no-pager",
        "--no-optional-locks",
        "--workspace-root",
        "-r",
        "--recursive",
      ].includes(word)
    ) {
      return undefined;
    }
  }
  return index;
}

/** Keep option values out of command/subcommand positions. */
export function repositoryCommandHead(words: string[]): string[] {
  const index = commandActionIndex(words);
  return [words[0] ?? "", ...(index === undefined ? [] : words.slice(index, index + 2))];
}

export function repositoryInvocations(text: string): string[][] {
  const direct = shellNonDisplayInvocations(text);
  const wrapped = direct.flatMap((words) => {
    const index = commandActionIndex(words);
    if (
      index === undefined ||
      !["npm", "pnpm", "yarn", "bun"].includes(words[0] ?? "") ||
      !["exec", "dlx", "x"].includes(words[index] ?? "")
    ) {
      return [];
    }
    let toolIndex = index + 1;
    while (["--", "--yes", "-y", "--no-install"].includes(words[toolIndex] ?? "")) {
      toolIndex++;
    }
    return words[toolIndex] && !words[toolIndex]!.startsWith("-") ? [words.slice(toolIndex)] : [];
  });
  return [...direct, ...shellNonDisplayInvocations(text, true), ...wrapped].filter(
    ([tool]) =>
      ![
        "<",
        ">",
        "echo",
        "printf",
        "/bin/echo",
        "/usr/bin/echo",
        "/bin/printf",
        "/usr/bin/printf",
      ].includes(tool ?? ""),
  );
}

export function textHasHistoryDependentExecution(text: string): boolean {
  return repositoryInvocations(text).some((words) => {
    const head = repositoryCommandHead(words);
    const [tool, action] = head;
    if (tool === "git") {
      return [
        "fetch",
        "pull",
        "rebase",
        "merge",
        "push",
        "describe",
        "diff",
        "log",
        "rev-list",
        "tag",
      ].includes(action ?? "");
    }
    if (
      (tool === "lerna" && action === "changed") ||
      (tool === "nx" && action === "affected") ||
      (tool === "turbo" && action === "run")
    ) {
      return true;
    }
    const name =
      ["npm", "pnpm", "yarn", "bun"].includes(tool ?? "") &&
      ["exec", "dlx", "x"].includes(action ?? "")
        ? (head[2] ?? "")
        : invocationWorkName(head);
    return /(?:^|[/])(?:commitlint|semantic-release|release-it|changeset|get-release-version|changelog|git-cliff|conventional-changelog)(?:$|[.:-])/.test(
      name,
    );
  });
}

/** Empty/unsupported extraction is unknown, not proof that no repository work executes. */
export function textHasOpaqueRepositoryExecution(text: string): boolean {
  if (text.trim() && shellExecutionTexts(text).length === 0) {
    return true;
  }
  return repositoryInvocations(text).some((words) => {
    const [tool = "", action] = words;
    if (/^[$`-]/.test(tool) || tool.includes("__shell_substitution__")) {
      return true;
    }
    if (
      /^(?:\.\.?\/|(?:scripts?|dev|tools|bin|hack|tasks)\/)/.test(tool) ||
      /\.(?:sh|[cm]?[jt]sx?|py)$/.test(tool)
    ) {
      return true;
    }
    if (["eval", "source", ".", "for", "case", "select", "function"].includes(tool)) {
      return true;
    }
    if (
      /^(?:\/.*\/)?(?:ba|z|da|k)?sh$|^(?:node|bun|python(?:\d+(?:\.\d+)?)?|ruby|perl|pwsh|powershell)$/.test(
        tool,
      )
    ) {
      return !["--version", "-V", "--help", "-h"].includes(action ?? "");
    }
    if (["pixi", "uv", "poetry", "hatch", "pdm"].includes(tool) && action === "run") {
      return true;
    }
    if (
      tool === "git" &&
      (words.some((word) => word.includes("alias.")) ||
        (words.length > 1 && repositoryCommandHead(words).length < 2))
    ) {
      return true;
    }
    if (
      /^pip\d*$/.test(tool) &&
      action === "install" &&
      words.some((word) => /^-[a-z]*e[a-z]*$/.test(word) || word === "--editable") &&
      words.includes(".")
    ) {
      return true;
    }
    return tool === "pyodide" && action === "build";
  });
}

/** Raw target words of actual redirections, retaining quotes and unknown expansions. */
export function shellFileRedirectionTargets(text: string): string[] {
  const targets: string[] = [];
  for (const source of shellExecutionTexts(text)) {
    let quote = "";
    for (let index = 0; index < source.length; index++) {
      const char = source[index]!;
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
      if ((char === ">" || char === "<") && source[index + 1] !== "(") {
        while (source[index + 1] === char) {
          index++;
        }
        let start = index + 1;
        while (/\s/.test(source[start] ?? "") && start < source.length) {
          start++;
        }
        let end = start;
        let targetQuote = "";
        for (; end < source.length; end++) {
          const next = source[end]!;
          if (next === "\\" && targetQuote !== "'") {
            end++;
            continue;
          }
          if (targetQuote) {
            if (next === targetQuote) {
              targetQuote = "";
            }
            continue;
          }
          if (next === "'" || next === '"') {
            targetQuote = next;
            continue;
          }
          if (/[\s;|<>()]/.test(next) || (next === "&" && end !== start)) {
            break;
          }
        }
        targets.push(source.slice(start, end));
        index = Math.max(index, end - 1);
      }
    }
  }
  return targets;
}

/** Unlike displayed '>' text, a real redirect may read/write checked-out files. */
export function textHasShellFileRedirection(text: string): boolean {
  return shellFileRedirectionTargets(text).some(
    (target) =>
      !/^(?:"\$(?:GITHUB_(?:ENV|OUTPUT|STATE|PATH|STEP_SUMMARY)|\{GITHUB_(?:ENV|OUTPUT|STATE|PATH|STEP_SUMMARY)\})"|\$(?:GITHUB_(?:ENV|OUTPUT|STATE|PATH|STEP_SUMMARY)|\{GITHUB_(?:ENV|OUTPUT|STATE|PATH|STEP_SUMMARY)\})|\/dev\/null)$/.test(
        target,
      ),
  );
}

export function textHasWideRepositoryAccess(text: string): boolean {
  return repositoryInvocations(text).some((words) => {
    const [tool, action] = repositoryCommandHead(words);
    if (["find", "fd"].includes(tool ?? "")) {
      return (
        words.slice(1).some((word) => word === "." || word.startsWith("./")) || words.length === 1
      );
    }
    if (tool === "rg") {
      return words.includes("--files") || words.includes(".");
    }
    if (tool === "git") {
      return action === "grep";
    }
    if (tool === "ls") {
      return words.slice(1).some((word) => /^-[a-z]*r/i.test(word) || word === "--recursive");
    }
    if (tool === "du") {
      return words.slice(1).some((word) => word.startsWith("-"));
    }
    return (
      tool === "lerna" ||
      (tool === "turbo" && action === "run") ||
      (tool === "nx" && action === "affected")
    );
  });
}
