import path from "node:path";
import { shellCommandSegments, shellCommands } from "./command-patterns.ts";

/** Resolve CircleCI parameter expressions; unresolved text is not a static scope. */
export function resolveCircleCiExpression(
  text: string,
  parameters: ReadonlyMap<string, string>,
): string | undefined {
  const resolved = text.replace(
    /<<\s*parameters\.([\w-]+)\s*>>/g,
    (_match, name: string) => parameters.get(name) ?? `<<${name}>>`,
  );
  if (/<<|\$[({]/.test(resolved)) {
    return undefined;
  }
  return resolved;
}

function normalizeDirectory(raw: string, base: string | undefined): string | undefined {
  let value = raw.trim().replace(/^["']|["']$/g, "");
  value = value
    .replace(/^~\/project\/?/, "")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (value.startsWith("/")) {
    return value;
  }
  return base && base !== "." ? `${base.replace(/\/+$/, "")}/${value}` : value;
}

/** Earlier `cd` / `pushd` segments in the same command, including multi-line blocks. */
export function commandWorkingDirectory(
  command: string,
  initialDirectory: string | undefined,
  parameters: ReadonlyMap<string, string>,
): string | undefined {
  let current = initialDirectory;
  for (const segment of shellCommandSegments(command)) {
    const words = shellCommands(segment)[0] ?? [];
    if ((words[0] === "cd" || words[0] === "pushd") && words[1]) {
      const resolved = resolveCircleCiExpression(words[1], parameters);
      if (!resolved) {
        return undefined;
      }
      current = normalizeDirectory(resolved, current);
      if (current === undefined) {
        return undefined;
      }
    }
  }
  return current;
}

function flagValue(tokens: string[], flags: readonly string[]): string | undefined {
  for (let index = 0; index < tokens.length; index++) {
    if (flags.includes(tokens[index]!)) {
      return tokens[index + 1];
    }
  }
  return undefined;
}

/** Tool flags that select a project root for the test command itself. */
export function commandFlagDirectory(
  tokens: string[],
  currentDirectory: string | undefined,
  parameters: ReadonlyMap<string, string>,
): string | undefined {
  const tool = (tokens[0] ?? "").split(/[\\/]/).at(-1) ?? "";
  let raw: string | undefined;
  if (tool === "npm") {
    raw = flagValue(tokens, ["--prefix", "-C"]);
  } else if (tool === "yarn") {
    raw = flagValue(tokens, ["--cwd"]);
  } else if (tool === "pnpm") {
    raw = flagValue(tokens, ["-C", "--dir"]);
  } else if (tool === "gradle" || tool === "gradlew") {
    raw = flagValue(tokens, ["-p"]);
  } else if (tool === "mvn" || tool === "mvnw") {
    const pom = flagValue(tokens, ["-f"]);
    raw = pom ? path.posix.dirname(pom.replace(/\\/g, "/")) : undefined;
  } else if (tool === "make") {
    raw = flagValue(tokens, ["-C"]);
  } else if (tool === "go" && tokens[1] === "test") {
    const scoped = tokens.slice(2).find((token) => /^\.\/.*\/\.\.\.$/.test(token));
    raw = scoped?.replace(/\/\.\.\.$/, "");
  }
  if (!raw) {
    return currentDirectory;
  }
  const resolved = resolveCircleCiExpression(raw, parameters);
  if (!resolved) {
    return undefined;
  }
  return normalizeDirectory(resolved, currentDirectory);
}
