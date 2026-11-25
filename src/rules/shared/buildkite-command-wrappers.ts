const valueOptions: Record<string, readonly string[]> = {
  xargs: [
    "-n",
    "-P",
    "-L",
    "-s",
    "-I",
    "-d",
    "-E",
    "-a",
    "--max-args",
    "--max-procs",
    "--max-lines",
    "--max-chars",
    "--replace",
    "--delimiter",
    "--eof",
    "--arg-file",
  ],
  timeout: ["-k", "-s", "--kill-after", "--signal"],
  nice: ["-n", "--adjustment"],
};
const flags: Record<string, readonly string[]> = {
  xargs: [
    "-0",
    "-r",
    "-t",
    "-p",
    "-x",
    "--null",
    "--no-run-if-empty",
    "--verbose",
    "--interactive",
    "--exit",
  ],
  timeout: ["--foreground", "--preserve-status", "-v", "--verbose"],
  nice: [],
};

/** Resolve only fixed command positions; never expand xargs input or shell strings. */
export function unwrapBuildkiteCommand(words: string[], depth = 0): string[] | undefined {
  const program = words[0] ?? "";
  const tool = /^\/(?:usr\/)?bin\/(?:xargs|timeout|nice)$/.test(program)
    ? program.split("/").at(-1)!
    : program;
  const valued = Object.hasOwn(valueOptions, tool) ? valueOptions[tool] : undefined;
  if (!valued) {
    return words;
  }
  if (depth >= 4) {
    return undefined;
  }
  let index = 1;
  let replacement: string | undefined;
  while (words[index]?.startsWith("-") && words[index] !== "--") {
    const word = words[index++]!;
    if (flags[tool]?.includes(word)) {
      continue;
    }
    const equal = word.indexOf("=");
    // GNU optional long-option values require "=". Without it, the next
    // token is the command, not an option value.
    if (tool === "xargs" && equal < 0 && ["--replace", "--eof", "--max-lines"].includes(word)) {
      if (word === "--replace") {
        replacement = "{}";
      }
      continue;
    }
    let name = equal > 0 ? word.slice(0, equal) : word;
    let value = equal > 0 ? word.slice(equal + 1) : undefined;
    if (!valued.includes(name) && !word.startsWith("--")) {
      const short = word.slice(0, 2);
      if (valued.includes(short)) {
        name = short;
        value = word.slice(2);
      }
    }
    if (!valued.includes(name)) {
      return undefined;
    }
    value ??= words[index++];
    if (!value) {
      return undefined;
    }
    if (name === "-I" || name === "--replace") {
      if (/[$`]/.test(value)) {
        return undefined;
      }
      replacement = value;
    }
  }
  if (words[index] === "--") {
    index++;
  }
  if (tool === "timeout") {
    if (words[index] === undefined) {
      return undefined;
    }
    index++; // The duration is an operand, not the command name.
  }
  const command = words.slice(index);
  if (command.length === 0) {
    return tool === "xargs" ? ["echo"] : undefined;
  }
  if (replacement && command[0]!.includes(replacement)) {
    return undefined;
  }
  return unwrapBuildkiteCommand(command, depth + 1);
}
