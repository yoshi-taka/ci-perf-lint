import path from "node:path";
import type { SourceImport, SourceWildcardExport } from "./source-audit-parser.ts";
import { exceedsSourceLimit, MAX_BARREL_SOURCES } from "./source-size-policy.ts";

export interface SourceBarrel {
  relativePath: string;
  line: number;
  column: number;
  sourceCount: number;
}

const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Repository-relative source resolution only. Ambiguous/alias/package paths stay leaves. */
export function resolveSourceReference(
  from: string,
  source: string,
  files: ReadonlySet<string>,
): string {
  if (!/^\.{1,2}(?:\/|$)/.test(source)) {
    return `package:${source}`;
  }
  const target = path.posix.join(path.posix.dirname(from), source);
  if (files.has(target)) {
    return `file:${target}`;
  }
  const candidates = [
    ...sourceExtensions.map((extension) => target + extension),
    ...sourceExtensions.map((extension) => `${target}/index${extension}`),
  ];
  const runtimeExtension = /\.(mjs|cjs|js|jsx)$/.exec(target)?.[1];
  if (runtimeExtension) {
    const stem = target.slice(0, -runtimeExtension.length - 1);
    candidates.push(
      ...(runtimeExtension === "mjs"
        ? [".mts"]
        : runtimeExtension === "cjs"
          ? [".cts"]
          : [".ts", ".tsx"]
      ).map((extension) => stem + extension),
    );
  }
  const matches = [...new Set(candidates.filter((candidate) => files.has(candidate)))];
  return matches.length === 1 ? `file:${matches[0]}` : `relative:${target}`;
}

/** Relative resolution depends on directory and request in a fixed audit inventory. */
export function createSourceReferenceResolver(
  files: ReadonlySet<string>,
): (from: string, source: string) => string {
  const directories = new Map<string, Map<string, string>>();
  const importers = new Map<string, Map<string, string>>();
  return (from, source) => {
    if (!/^\.{1,2}(?:\/|$)/.test(source)) {
      return `package:${source}`;
    }
    let requests = importers.get(from);
    if (!requests) {
      const directory = path.posix.dirname(from);
      requests = directories.get(directory);
      if (!requests) {
        requests = new Map();
        directories.set(directory, requests);
      }
      importers.set(from, requests);
    }
    const cached = requests.get(source);
    if (cached !== undefined) {
      return cached;
    }
    const resolved = resolveSourceReference(from, source, files);
    requests.set(source, resolved);
    return resolved;
  };
}

/** Bounded static reference graph, not a full bundler/TypeScript resolver. */
export function findLargeBarrels(
  imports: readonly SourceImport[],
  wildcardExports: readonly SourceWildcardExport[],
  sourceFiles: ReadonlySet<string>,
  resolve: (from: string, source: string) => string = (from, source) =>
    resolveSourceReference(from, source, sourceFiles),
): SourceBarrel[] {
  if (!wildcardExports.length) {
    return [];
  }
  const edges = new Map<string, Set<string>>();
  for (const entry of imports) {
    if (entry.dynamic) {
      continue;
    }
    const targets = edges.get(entry.relativePath) ?? new Set<string>();
    targets.add(resolve(entry.relativePath, entry.source));
    edges.set(entry.relativePath, targets);
  }
  const roots = new Map<string, SourceWildcardExport[]>();
  for (const entry of wildcardExports) {
    const entries = roots.get(entry.relativePath) ?? [];
    entries.push(entry);
    roots.set(entry.relativePath, entries);
  }
  const findings: SourceBarrel[] = [];
  for (const [filename, exports] of roots) {
    const first = exports[0]!;
    const seen = new Set([`file:${filename}`]);
    const pending = [...new Set(exports.map((entry) => resolve(filename, entry.source)))];
    while (pending.length) {
      const target = pending.pop()!;
      if (seen.has(target)) {
        continue;
      }
      seen.add(target);
      if (exceedsSourceLimit(seen.size - 1, MAX_BARREL_SOURCES)) {
        break;
      }
      if (target.startsWith("file:")) {
        for (const edge of edges.get(target.slice(5)) ?? []) {
          pending.push(edge);
        }
      }
    }
    if (exceedsSourceLimit(seen.size - 1, MAX_BARREL_SOURCES)) {
      findings.push({
        relativePath: filename,
        line: first.line,
        column: first.column,
        sourceCount: seen.size - 1,
      });
    }
  }
  return findings;
}
