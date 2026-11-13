import path from "node:path";
import { parseDocument } from "../yaml.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  readSourceConfig,
  sourceConfigRecord,
  sourceGlob,
  sourceMapMatch,
  sourcePath,
} from "./source-config.ts";
import { resolveSourceReference } from "./source-barrel-graph.ts";

interface Manifest {
  directory: string;
  value: Record<string, unknown>;
}

async function workspacePatterns(
  context: RepositoryScanContext,
  root: Manifest | undefined,
  inventory: ReadonlySet<string>,
): Promise<string[]> {
  const workspaces = root?.value.workspaces;
  const raw = Array.isArray(workspaces) ? workspaces : sourceConfigRecord(workspaces)?.packages;
  const patterns: unknown[] = Array.isArray(raw) ? [...raw] : [];
  if (inventory.has("pnpm-workspace.yaml")) {
    try {
      const text = await context.readTextFileOrWarn(context.resolve("pnpm-workspace.yaml"));
      if (text === undefined || Buffer.byteLength(text) > 262_144) {
        throw new Error("Unreadable workspace file");
      }
      const document = parseDocument(text);
      if (document.errors.length || document.warnings.length) {
        throw new Error("Unsupported workspace syntax");
      }
      const packages = sourceConfigRecord(document.toJS({ maxAliasCount: 20 }))?.packages;
      if (!Array.isArray(packages)) {
        throw new Error("Invalid packages list");
      }
      patterns.push(...packages);
    } catch {
      context.warn(
        "source-audit",
        "Source resolution incomplete: unsupported pnpm-workspace.yaml; workspace traversal disabled.",
      );
      return [];
    }
  }
  if (
    patterns.length > 512 ||
    patterns.some(
      (pattern) => typeof pattern !== "string" || !sourceGlob(pattern.replace(/^!/, "")),
    )
  ) {
    context.warn(
      "source-audit",
      "Source resolution incomplete: unsupported workspace patterns; workspace traversal disabled.",
    );
    return [];
  }
  return patterns as string[];
}

/** Declared local workspace packages and literal imports/exports maps only. */
export async function createPackageReferences(
  context: RepositoryScanContext,
  inventory: ReadonlySet<string>,
  sources: ReadonlySet<string>,
): Promise<(from: string, request: string) => string | undefined> {
  const filenames = [...inventory].filter((file) => path.posix.basename(file) === "package.json");
  if (filenames.length > 2048) {
    context.warn(
      "source-audit",
      "Source resolution incomplete: more than 2048 package manifests; workspace traversal disabled.",
    );
    return () => undefined;
  }
  const manifests = new Map<string, Manifest>();
  for (const filename of filenames) {
    const value = await readSourceConfig(context, filename, false);
    const directory = path.posix.dirname(filename);
    manifests.set(directory, { directory, value: value ?? {} });
  }
  const patterns = await workspacePatterns(context, manifests.get("."), inventory);
  const positive = patterns
    .filter((pattern) => !pattern.startsWith("!"))
    .map((pattern) => sourceGlob(pattern)!);
  const negative = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => sourceGlob(pattern.slice(1))!);
  const packages = new Map<string, Manifest[]>();
  for (const manifest of manifests.values()) {
    const name = manifest.value.name;
    if (
      manifest.directory === "." ||
      typeof name !== "string" ||
      !positive.some((pattern) => pattern.test(manifest.directory)) ||
      negative.some((pattern) => pattern.test(manifest.directory))
    ) {
      continue;
    }
    const entries = packages.get(name) ?? [];
    entries.push(manifest);
    packages.set(name, entries);
  }
  const nearest = new Map<string, Manifest | undefined>();
  function forFile(filename: string): Manifest | undefined {
    const directory = path.posix.dirname(filename);
    if (nearest.has(directory)) {
      return nearest.get(directory);
    }
    let current = directory;
    for (;;) {
      const manifest = manifests.get(current);
      if (manifest) {
        nearest.set(directory, manifest);
        return manifest;
      }
      if (current === ".") {
        break;
      }
      current = path.posix.dirname(current);
    }
    nearest.set(directory, undefined);
    return undefined;
  }
  function targetReference(manifest: Manifest, value: unknown, star?: string): string | undefined {
    if (
      typeof value !== "string" ||
      !value.startsWith("./") ||
      value.split("*").length > 2 ||
      (value.includes("*") && star === undefined)
    ) {
      return undefined;
    }
    const target = sourcePath(manifest.directory, value.replace("*", star ?? ""));
    if (!target || (manifest.directory !== "." && !target.startsWith(`${manifest.directory}/`))) {
      return undefined;
    }
    const resolved = resolveSourceReference("__root__.ts", `./${target}`, sources);
    return resolved.startsWith("file:") ? resolved : undefined;
  }
  function agreedTarget(
    manifest: Manifest,
    value: unknown,
    star?: string,
    depth = 0,
  ): string | undefined {
    if (typeof value === "string") {
      return targetReference(manifest, value, star);
    }
    if (depth >= 8) {
      return undefined;
    }
    const record = sourceConfigRecord(value);
    const alternatives = Array.isArray(value)
      ? value
      : record && Object.keys(record).every((key) => !key.startsWith("."))
        ? Object.values(record)
        : [];
    if (!alternatives.length || alternatives.length > 32) {
      return undefined;
    }
    const resolved = alternatives.map((alternative) =>
      agreedTarget(manifest, alternative, star, depth + 1),
    );
    return resolved.every(Boolean) && new Set(resolved).size === 1 ? resolved[0] : undefined;
  }
  return (from, request) => {
    const own = forFile(from);
    if (request.startsWith("#")) {
      const imports = sourceConfigRecord(own?.value.imports);
      const match = imports && sourceMapMatch(imports, request);
      return own && match ? agreedTarget(own, match.value, match.star) : undefined;
    }
    const parts = request.split("/");
    if (parts.some((part) => part === "." || part === ".." || !part)) {
      return undefined;
    }
    const name = parts.slice(0, request.startsWith("@") ? 2 : 1).join("/");
    const candidates =
      own?.value.name === name && Object.hasOwn(own.value, "exports") ? [own] : packages.get(name);
    if (candidates?.length !== 1) {
      return undefined;
    }
    const manifest = candidates[0]!;
    const subpath = request.slice(name.length);
    if (Object.hasOwn(manifest.value, "exports")) {
      const exports = manifest.value.exports;
      if (typeof exports === "string" || Array.isArray(exports)) {
        return subpath ? undefined : agreedTarget(manifest, exports);
      }
      const map = sourceConfigRecord(exports);
      if (map && Object.keys(map).every((key) => !key.startsWith("."))) {
        return subpath ? undefined : agreedTarget(manifest, map);
      }
      if (map && Object.keys(map).some((key) => key !== "." && !key.startsWith("./"))) {
        return undefined;
      }
      const match = map && sourceMapMatch(map, subpath ? `.${subpath}` : ".");
      return match ? agreedTarget(manifest, match.value, match.star) : undefined;
    }
    if (subpath) {
      return targetReference(manifest, `.${subpath}`);
    }
    // Bundlers may prefer `module`; Node/TS retain main or the implicit index.
    // Without an environment-specific resolver, follow only agreement.
    const entries = [manifest.value.main ?? "./index", manifest.value.module].filter(
      (value) => value !== undefined,
    );
    const resolved = entries.map((value) =>
      typeof value === "string"
        ? targetReference(manifest, value.startsWith("./") ? value : `./${value}`)
        : undefined,
    );
    return resolved.every(Boolean) && new Set(resolved).size === 1 ? resolved[0] : undefined;
  };
}
