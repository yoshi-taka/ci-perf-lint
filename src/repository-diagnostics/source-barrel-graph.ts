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
  const ids = new Map<string, number>();
  function idFor(target: string): number {
    let id = ids.get(target);
    if (id === undefined) {
      ids.set(target, (id = ids.size));
    }
    return id;
  }
  const fromIds = new Uint32Array(imports.length);
  const targetIds = new Uint32Array(imports.length);
  let edgeCount = 0;
  let previousFile: string | undefined;
  let previousId = 0;
  for (const entry of imports) {
    if (entry.dynamic) {
      continue;
    }
    if (entry.relativePath !== previousFile) {
      previousFile = entry.relativePath;
      previousId = idFor(`file:${previousFile}`);
    }
    fromIds[edgeCount] = previousId;
    targetIds[edgeCount++] = idFor(resolve(entry.relativePath, entry.source));
  }
  const roots = new Map<string, SourceWildcardExport[]>();
  for (const entry of wildcardExports) {
    const entries = roots.get(entry.relativePath) ?? [];
    entries.push(entry);
    roots.set(entry.relativePath, entries);
  }
  const ready: {
    filename: string;
    first: SourceWildcardExport;
    id: number;
    targets: number[];
  }[] = [];
  for (const [filename, exports] of roots) {
    const first = exports[0]!;
    const id = idFor(`file:${filename}`);
    const targets = exports.map((entry) => idFor(resolve(filename, entry.source)));
    ready.push({ filename, first, id, targets });
  }
  const nodeCount = ids.size;
  ids.clear();
  roots.clear();
  const offsets = new Uint32Array(nodeCount + 1);
  const adjacency = new Uint32Array(edgeCount);
  for (let at = 0; at < edgeCount; at++) {
    const index = fromIds[at]! + 1;
    offsets[index] = offsets[index]! + 1;
  }
  for (let id = 1; id <= nodeCount; id++) {
    offsets[id] = offsets[id]! + offsets[id - 1]!;
  }
  // Reuse the scatter cursors as generation stamps after construction.
  const seen = offsets.slice();
  for (let at = 0; at < edgeCount; at++) {
    const from = fromIds[at]!;
    const cursor = seen[from]!;
    adjacency[cursor] = targetIds[at]!;
    seen[from] = cursor + 1;
  }
  seen.fill(0);
  // Mark on enqueue: every node enters the frontier at most once per root.
  // The source-ID staging buffer is no longer needed after the scatter.
  const pending =
    fromIds.length >= nodeCount ? fromIds.subarray(0, nodeCount) : new Uint32Array(nodeCount);
  const findings: SourceBarrel[] = [];
  let generation = 0;
  for (const root of ready) {
    if (++generation > 0xffffffff) {
      seen.fill(0);
      generation = 1;
    }
    seen[root.id] = generation;
    let top = 0;
    let count = 0;
    for (const target of root.targets) {
      if (seen[target] === generation) {
        continue;
      }
      seen[target] = generation;
      pending[top++] = target;
    }
    while (top > 0) {
      const target = pending[--top]!;
      count++;
      if (exceedsSourceLimit(count, MAX_BARREL_SOURCES)) {
        break;
      }
      for (let at = offsets[target]!; at < offsets[target + 1]!; at++) {
        const next = adjacency[at]!;
        if (seen[next] === generation) {
          continue;
        }
        seen[next] = generation;
        pending[top++] = next;
      }
    }
    if (exceedsSourceLimit(count, MAX_BARREL_SOURCES)) {
      findings.push({
        relativePath: root.filename,
        line: root.first.line,
        column: root.first.column,
        sourceCount: count,
      });
    }
  }
  return findings;
}
