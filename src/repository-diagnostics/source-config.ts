import path from "node:path";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { parseSourceConfig } from "./source-config-json.ts";

export function sourceConfigRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function sourcePath(directory: string, target: string): string | undefined {
  if (path.posix.isAbsolute(target) || target.includes("\\") || /[?#\0]/.test(target)) {
    return undefined;
  }
  const joined = path.posix.join(directory, target);
  return joined === ".." || joined.startsWith("../") ? undefined : joined;
}

/** Exact keys win; one-star patterns use longest prefix, then longest suffix. */
export function sourceMapMatch(
  map: Record<string, unknown>,
  request: string,
  rejectPrefixTies = false,
): { value: unknown; star?: string } | undefined {
  if (Object.keys(map).length > 1024) {
    return { value: undefined };
  }
  if (Object.hasOwn(map, request)) {
    return { value: map[request] };
  }
  const matches = Object.keys(map)
    .flatMap((key) => {
      const parts = key.split("*");
      if (
        parts.length !== 2 ||
        !request.startsWith(parts[0]!) ||
        !request.endsWith(parts[1]!) ||
        request.length < key.length - 1
      ) {
        return [];
      }
      return [{ key, prefix: parts[0]!, suffix: parts[1]! }];
    })
    .sort((a, b) => b.prefix.length - a.prefix.length || b.suffix.length - a.suffix.length);
  const match = matches[0];
  if (rejectPrefixTies && match && matches[1]?.prefix.length === match.prefix.length) {
    return { value: undefined };
  }
  return match
    ? {
        value: map[match.key],
        star: request.slice(match.prefix.length, request.length - match.suffix.length),
      }
    : undefined;
}

/** Deliberately small glob subset: *, ** and literal path components. */
export function sourceGlob(pattern: string): RegExp | undefined {
  if (/[?{}[\]\\\0]/.test(pattern) || pattern.split("/").includes("..")) {
    return undefined;
  }
  const parts = pattern.replace(/^\.\//, "").replace(/\/$/, "").split("/");
  const expression = parts
    .map((part, index) =>
      part === "**"
        ? index === parts.length - 1
          ? ".*"
          : "(?:[^/]+/)*"
        : part.replace(/[.+^$()|]/g, "\\$&").replace(/\*/g, "[^/]*") +
          (index === parts.length - 1 ? "" : "/"),
    )
    .join("");
  return new RegExp(`^${expression}$`);
}

export async function readSourceConfig(
  context: RepositoryScanContext,
  filename: string,
  jsonc = true,
): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await context.readTextFileOrWarn(context.resolve(filename));
    const value =
      text !== undefined && Buffer.byteLength(text) <= 262_144
        ? jsonc
          ? parseSourceConfig(text)
          : sourceConfigRecord(JSON.parse(text))
        : undefined;
    if (!value) {
      context.warn(
        "source-audit",
        `Source resolution incomplete: invalid, unreadable or oversized static config ${filename}.`,
      );
    }
    return value;
  } catch {
    context.warn(
      "source-audit",
      `Source resolution incomplete: failed to read static config ${filename}.`,
    );
    return undefined;
  }
}
