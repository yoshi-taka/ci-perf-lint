const npmRunMatcher = /^\s*npm\s+(?:run|run-script)\s+([A-Za-z0-9:_./-]+)(\s+--(?:\s+.*)?)?\s*$/;
const commandTokenPattern = /(?:'[^']*'|"[^"]*"|\\[^\r\n]|[^\s'"\\;&|()<>])+|[;&|()<>]|\r?\n/g;
const commandSeparatorPattern = /^[;&|()\r\n]+$/;

/** Tokenize command arguments while preserving quoted words and dynamic values. */
export function shellCommands(text: string): string[][] {
  const commands: string[][] = [];
  let tokens: string[] = [];
  let comment = false;
  for (const match of text.replace(/\\\r?\n/g, " ").matchAll(commandTokenPattern)) {
    const token = match[0];
    if (/^\r?\n$/.test(token)) {
      comment = false;
    }
    if (comment) {
      continue;
    }
    if (token.startsWith("#")) {
      comment = true;
    } else if (commandSeparatorPattern.test(token)) {
      commands.push(tokens);
      tokens = [];
    } else {
      tokens.push(
        token.replace(
          /'([^']*)'|"([^"]*)"/g,
          (_match, single: string | undefined, double: string | undefined) =>
            single ?? double ?? "",
        ),
      );
    }
  }
  commands.push(tokens);
  return commands;
}

export function detectSimpleNpmRunFromText(
  text: string,
): { script: string; replacement: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("\n")) {
    return undefined;
  }
  const match = trimmed.match(npmRunMatcher);
  const script = match?.[1];
  if (!script) {
    return undefined;
  }
  const passthrough = match[2]?.trim() ?? "";
  return {
    script,
    replacement: passthrough ? `node --run ${script} ${passthrough}` : `node --run ${script}`,
  };
}

/** Static words only: unknown expansion or shell control must not prove equivalence. */
export function staticShellWords(text: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (/[$`]/.test(char)) {
      return undefined;
    }
    if (char === "\\" && quote !== "'") {
      const next = text[++i];
      if (next === undefined) {
        return undefined;
      }
      if (next !== "\n") {
        word += next;
        started = true;
      }
    } else if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        word += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/[;&|<>()\n]/.test(char)) {
      return undefined;
    } else if (char === "#" && !started) {
      break;
    } else if (/\s/.test(char)) {
      if (started) {
        words.push(word);
      }
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) {
    return undefined;
  }
  if (started) {
    words.push(word);
  }
  return words;
}

function staticCommandWord(
  text: string,
  tokens: readonly RegExpExecArray[],
  index: number,
): string | undefined {
  const token = tokens[index];
  if (!token) {
    return undefined;
  }
  const previous = tokens[index - 1];
  const start = previous ? previous.index + previous[0].length : 0;
  if (!/^\s*$/.test(text.slice(start, token.index))) {
    return undefined;
  }
  const words = staticShellWords(token[0]);
  return words?.length === 1 ? words[0] : undefined;
}

/** Resolve a known bootstrap prefix without rebuilding the command's arguments. */
export function parseBootstrapInvocation(
  text: string,
): { tool: string; command: string } | undefined {
  const trimmed = text.trim();
  const tokens = [...trimmed.matchAll(commandTokenPattern)];
  const word = (index: number) => staticCommandWord(trimmed, tokens, index);
  const runner = word(0)?.toLowerCase();
  let index = 1;
  if (runner === "pnpm" || runner === "yarn") {
    if (word(index++) !== "dlx") {
      return undefined;
    }
  } else if (runner === "uv") {
    if (word(index++) !== "tool" || word(index++) !== "run") {
      return undefined;
    }
  } else if (!runner || !["npx", "pnpx", "bunx", "uvx"].includes(runner)) {
    return undefined;
  }
  const packages: string[] = [];
  let tool = word(index);
  while (tool?.startsWith("-")) {
    if (tool === "--") {
      tool = word(++index);
      break;
    }
    if (runner !== "npx") {
      return undefined;
    }
    if (
      ["--yes", "-y", "--no", "--no-install"].includes(tool) ||
      /^--(?:yes|no)=(?:true|false)$/.test(tool)
    ) {
      index++;
    } else if (tool === "--package" || tool === "-p") {
      const pkg = word(++index);
      if (!pkg || pkg.startsWith("-")) {
        return undefined;
      }
      packages.push(pkg);
      index++;
    } else if (tool.startsWith("--package=")) {
      const pkg = tool.slice("--package=".length);
      if (!pkg) {
        return undefined;
      }
      packages.push(pkg);
      index++;
    } else {
      return undefined;
    }
    tool = word(index);
  }
  if (
    !tool ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(tool) ||
    packages.length > 1 ||
    (packages.length === 1 && packages[0] !== tool)
  ) {
    return undefined;
  }
  return { tool, command: trimmed.slice(tokens[index]!.index) };
}

export const MAKE_LIKE_RE = /^\s*(?:make|gmake)\b/;
export const HAS_PARALLEL_FLAG_RE = /(?:^|\s)(?:-j\s*\d*|--jobs(?:\s*=\s*\d+)?|--parallel)\b/;

const pipGlobalFlags = new Set([
  "--disable-pip-version-check",
  "--no-input",
  "--isolated",
  "--no-cache-dir",
  "--require-virtualenv",
  "--require-venv",
  "--no-color",
  "--quiet",
  "--verbose",
  "-q",
  "-v",
]);
const pipValueOptions = new Set([
  "--log",
  "--proxy",
  "--timeout",
  "--retries",
  "--cert",
  "--client-cert",
  "--cache-dir",
  "--python",
  "--index-url",
  "--extra-index-url",
  "--trusted-host",
  "-r",
  "--requirement",
  "-e",
  "--editable",
  "--config-settings",
  "-C",
  "--target",
  "-t",
  "--prefix",
  "--root",
  "--platform",
  "--python-version",
  "--implementation",
  "--abi",
  "--report",
  "--group",
  "--find-links",
  "-f",
]);
const pipOnlyFlags = new Set([
  "--disable-pip-version-check",
  "--no-input",
  "--require-virtualenv",
  "--require-venv",
  "--no-color",
  "--log",
  "--proxy",
  "--retries",
  "--trusted-host",
  "--use-deprecated",
  "--use-feature",
]);

interface PlainPipInstall {
  command: string;
  replacement?: string;
}

export function collectPlainPipInstalls(text: string): PlainPipInstall[] {
  if (
    shellCommands(text).some((tokens) =>
      tokens.some((token, index) => token === "<" && tokens[index + 1] === "<"),
    )
  ) {
    return [];
  }
  const installs: PlainPipInstall[] = [];
  for (const command of shellCommandSegments(text)) {
    const tokens = [...command.matchAll(commandTokenPattern)];
    const word = (index: number) => staticCommandWord(command, tokens, index);
    let index = word(0) === "env" ? 1 : 0;
    while (/^[A-Za-z_]\w*=/.test(word(index) ?? "")) {
      index++;
    }
    const executableIndex = index;
    const executable = word(index++) ?? "";
    const basename = executable.split("/").at(-1) ?? "";
    let python: string | undefined;
    let reviewOptions = executableIndex > 0;
    if (/^python(?:3(?:\.\d+)*)?$/.test(basename)) {
      python = tokens[executableIndex]![0];
      while (/^-(?:I|u|s|S|E|B)$/.test(word(index) ?? "")) {
        reviewOptions = true;
        index++;
      }
      if (word(index++) !== "-m" || word(index++) !== "pip") {
        continue;
      }
    } else if (/^pip(?:3(?:\.\d+)*)?$/.test(basename)) {
      if (executable !== basename) {
        reviewOptions = true;
      } else if (basename !== "pip") {
        python = basename.replace(/^pip/, "python");
      }
    } else {
      continue;
    }
    while (word(index)?.startsWith("-")) {
      const option = word(index)!;
      const name = option.split("=", 1)[0]!;
      if (
        !pipGlobalFlags.has(option) &&
        !/^-q+$|^-v+$/.test(option) &&
        !pipValueOptions.has(name)
      ) {
        break;
      }
      reviewOptions = true;
      index += pipValueOptions.has(name) && !option.includes("=") ? 2 : 1;
    }
    if (word(index) !== "install") {
      continue;
    }
    let inactive = false;
    for (let arg = index + 1; arg < tokens.length; arg++) {
      const value = word(arg);
      if (value === "--") {
        break;
      }
      const option = value?.split("=", 1)[0] ?? "";
      if (["--help", "-h", "--version", "--dry-run"].includes(option)) {
        inactive = true;
      }
      reviewOptions ||= pipOnlyFlags.has(option);
      if (pipValueOptions.has(option) && !value?.includes("=")) {
        arg++;
      }
    }
    const args = command.slice(tokens[index]!.index + tokens[index]![0].length).trim();
    if (!inactive && args) {
      installs.push({
        command,
        replacement: reviewOptions
          ? undefined
          : `uv pip install${python ? ` --python ${python}` : ""} ${args}`,
      });
    }
  }
  return installs;
}

export function detectPlainPipInstall(text: string): PlainPipInstall | undefined {
  return collectPlainPipInstalls(text)[0];
}

export function pipInstallSuggestion(install: PlainPipInstall): string {
  return install.replacement
    ? `Replace "${install.command}" with "${install.replacement}".`
    : `Review "${install.command}" and migrate to an equivalent "uv pip install" command, preserving its Python environment and translating pip-specific options.`;
}

export function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

/** Separate simple shell commands without splitting quoted arguments or continuations. */
export function shellCommandSegments(text: string): string[] {
  const commands: string[] = [];
  let command = "";
  let quote = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "\\" && quote !== "'") {
      const next = text[++index];
      if (next !== "\n") {
        command += char + (next ?? "");
      }
      continue;
    }
    if (quote) {
      command += char;
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      command += char;
    } else if (char === "#" && (command === "" || /\s$/.test(command))) {
      while (index + 1 < text.length && text[index + 1] !== "\n") {
        index++;
      }
    } else if (char === "\n" || char === ";" || char === "&" || char === "|") {
      if (command.trim()) {
        commands.push(command.trim());
      }
      command = "";
    } else {
      command += char;
    }
  }
  if (command.trim()) {
    commands.push(command.trim());
  }
  return commands;
}
