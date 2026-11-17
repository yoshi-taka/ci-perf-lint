import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseSync } from "oxc-parser";

interface Graph {
  /** local file -> local files it imports */
  edges: Map<string, Set<string>>;
}

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".mjs", ".json"];

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function collectImports(file: string, source: string): string[] {
  const parsed = parseSync(file, source);
  const imports: string[] = [];
  (function walk(node: unknown): void {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child);
      }
      return;
    }
    const record = node as { type?: string; source?: { value?: unknown }; arguments?: unknown[] };
    if (
      (record.type === "ImportDeclaration" ||
        record.type === "ExportNamedDeclaration" ||
        record.type === "ExportAllDeclaration") &&
      typeof record.source?.value === "string"
    ) {
      imports.push(record.source.value);
    }
    if (record.type === "ImportExpression") {
      const argument = record.arguments?.[0] as { value?: unknown } | undefined;
      if (typeof argument?.value === "string") {
        imports.push(argument.value);
      }
    }
    for (const [key, value] of Object.entries(record)) {
      if (key !== "type" && key !== "start" && key !== "end") {
        walk(value);
      }
    }
  })(parsed.program);
  return imports.filter(isLocalSpecifier);
}

async function resolveLocal(
  specifier: string,
  fromFile: string,
  projectRoot: string,
): Promise<string | undefined> {
  const base = path.resolve(projectRoot, path.dirname(fromFile), specifier);
  const candidates = RESOLVE_SUFFIXES.map((suffix) => base + suffix);
  candidates.push(path.join(base, "index.ts"), path.join(base, "index.tsx"));
  for (const candidate of candidates) {
    const relative = path.relative(projectRoot, candidate);
    if (relative.startsWith("..")) {
      continue;
    }
    try {
      await readFile(path.join(projectRoot, relative), "utf8");
      return relative;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

async function buildGraph(projectRoot: string, entries: string[]): Promise<Graph> {
  const edges = new Map<string, Set<string>>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (edges.has(file)) {
      continue;
    }
    let source: string;
    try {
      source = await readFile(path.join(projectRoot, file), "utf8");
    } catch {
      edges.set(file, new Set());
      continue;
    }
    const targets = new Set<string>();
    for (const specifier of collectImports(file, source)) {
      const resolved = await resolveLocal(specifier, file, projectRoot);
      if (resolved) {
        targets.add(resolved);
        if (!edges.has(resolved)) {
          queue.push(resolved);
        }
      }
    }
    edges.set(file, targets);
  }
  return { edges };
}

function closure(graph: Graph, start: string): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    for (const next of graph.edges.get(file) ?? []) {
      if (!seen.has(next)) {
        stack.push(next);
      }
    }
  }
  return seen;
}

/**
 * Derive a per-target test command by keeping only tests whose static import
 * closure contains the mutated file. Falls back to the original command when
 * a command has no explicit test files or a target is not imported anywhere.
 */
export async function deriveTestCommands(
  command: string,
  targets: string[],
  projectRoot: string,
): Promise<Map<string, string>> {
  const tokens = command.split(/\s+/).filter(Boolean);
  const testIndexes: number[] = [];
  const testFiles: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (/^test\/.*\.test\.ts$/.test(token)) {
      testIndexes.push(index);
      testFiles.push(token);
    }
  }
  const fallback = new Map(targets.map((target) => [target, command]));
  if (testFiles.length === 0 || targets.length <= 1) {
    return fallback;
  }

  const graph = await buildGraph(projectRoot, testFiles);
  const closures = new Map<string, Set<string>>();
  for (const testFile of testFiles) {
    closures.set(testFile, closure(graph, testFile));
  }

  const result = new Map<string, string>();
  for (const target of targets) {
    const selected = testFiles.filter((testFile) => closures.get(testFile)?.has(target));
    if (selected.length === 0 || selected.length === testFiles.length) {
      result.set(target, command);
      continue;
    }
    const output: string[] = [];
    for (const [index, token] of tokens.entries()) {
      if (index === testIndexes[0]) {
        output.push(...selected);
      } else if (!testIndexes.includes(index)) {
        output.push(token);
      }
    }
    result.set(target, output.join(" "));
  }
  return result;
}
