import path from "node:path";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
export { shellCommands } from "../rules/shared/command-patterns.ts";

const assignmentPattern = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

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
