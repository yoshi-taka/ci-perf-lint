import path from "node:path";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";

const tokenPattern = /(?:'[^']*'|"[^"]*"|\\[^\r\n]|[^\s'"\\;&|()<>])+|[;&|()<>]|\r?\n/g;
const separatorPattern = /^[;&|()\r\n]+$/;
const assignmentPattern = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function unquote(token: string): string {
  return token.replace(
    /'([^']*)'|"([^"]*)"/g,
    (_match, single: string | undefined, double: string | undefined) => single ?? double ?? "",
  );
}

export function shellCommands(text: string): string[][] {
  const commands: string[][] = [];
  let tokens: string[] = [];
  let comment = false;
  for (const match of text.replace(/\\\r?\n/g, " ").matchAll(tokenPattern)) {
    const token = match[0];
    if (/^\r?\n$/.test(token)) {
      comment = false;
    }
    if (comment) {
      continue;
    }
    if (token.startsWith("#")) {
      comment = true;
    } else if (separatorPattern.test(token)) {
      commands.push(tokens);
      tokens = [];
    } else {
      tokens.push(unquote(token));
    }
  }
  commands.push(tokens);
  return commands;
}

export function applyAssignments(tokens: string[], environment: Map<string, string>): number {
  let index = 0;
  for (const token of tokens) {
    const match = token.match(assignmentPattern);
    if (!match) {
      break;
    }
    environment.set(match[1]!, match[2]!);
    index += 1;
  }
  return index;
}

export function cacheIsMounted(
  cache: string,
  instruction: CollectedDockerfileInstruction,
  mountTypes: readonly ("cache" | "tmpfs")[] = ["cache"],
): boolean {
  if (!cache.startsWith("/") || /[$`]/.test(cache)) {
    return false;
  }
  return (instruction.flags ?? []).some((flag) => {
    if (flag.name !== "mount") {
      return false;
    }
    const options = new Map(
      (flag.value ?? "").split(",").map((option) => {
        const index = option.indexOf("=");
        return [option.slice(0, index), option.slice(index + 1)] as const;
      }),
    );
    const target = options.get("target") ?? options.get("dst") ?? options.get("destination");
    if (
      !mountTypes.some((type) => type === options.get("type")) ||
      !target?.startsWith("/") ||
      /[$`]/.test(target)
    ) {
      return false;
    }
    const normalized = path.posix.normalize(target).replace(/\/$/, "");
    return cache === normalized || cache.startsWith(`${normalized}/`);
  });
}

export function cacheIsCleaned(cache: string, commands: string[][]): boolean {
  if (!cache.startsWith("/") || /[$`]/.test(cache)) {
    return false;
  }
  return commands.some((tokens) => {
    if (tokens[0] !== "rm") {
      return false;
    }
    const redirect = tokens.findIndex((token) => token === ">" || token === "<");
    const args = redirect < 0 ? tokens.slice(1) : tokens.slice(1, redirect);
    if (!args.some((token) => /^-[a-z]*r[a-z]*$/.test(token) || token === "--recursive")) {
      return false;
    }
    return args.some((token) => {
      if (!token.startsWith("/") || /[$`*?]/.test(token)) {
        return false;
      }
      const directory = path.posix.normalize(token).replace(/\/$/, "");
      return cache === directory || cache.startsWith(`${directory}/`);
    });
  });
}
