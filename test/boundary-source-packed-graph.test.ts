import { expect, test } from "bun:test";
import fc from "fast-check";
import { fileURLToPath } from "node:url";
import type {
  SourceImport,
  SourceWildcardExport,
} from "../src/repository-diagnostics/source-audit-parser.ts";
import {
  findLargeBarrels,
  type SourceBarrel,
} from "../src/repository-diagnostics/source-barrel-graph.ts";

// Independent oracle: the previous string graph, retaining its resolver order.
function previous(
  imports: readonly SourceImport[],
  exports: readonly SourceWildcardExport[],
  resolve: (from: string, source: string) => string,
): SourceBarrel[] {
  if (!exports.length) {
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
  for (const entry of exports) {
    const items = roots.get(entry.relativePath) ?? [];
    items.push(entry);
    roots.set(entry.relativePath, items);
  }
  const findings: SourceBarrel[] = [];
  for (const [filename, entries] of roots) {
    const seen = new Set([`file:${filename}`]);
    const pending = [...new Set(entries.map((entry) => resolve(filename, entry.source)))];
    while (pending.length) {
      const target = pending.pop()!;
      if (seen.has(target)) {
        continue;
      }
      seen.add(target);
      if (seen.size - 1 > 100) {
        break;
      }
      if (target.startsWith("file:")) {
        for (const edge of edges.get(target.slice(5)) ?? []) {
          pending.push(edge);
        }
      }
    }
    if (seen.size - 1 > 100) {
      findings.push({
        relativePath: filename,
        line: entries[0]!.line,
        column: entries[0]!.column,
        sourceCount: seen.size - 1,
      });
    }
  }
  return findings;
}

function makeImport(relativePath: string, source: string, dynamic?: true): SourceImport {
  return {
    relativePath,
    source,
    dynamic,
    line: 1,
    column: 1,
    names: [],
    namespace: true,
    restricted: true,
    extensions: true,
  };
}

function compare(imports: SourceImport[], exports: SourceWildcardExport[]) {
  const beforeCalls: string[][] = [],
    afterCalls: string[][] = [];
  const resolve = (calls: string[][]) => (from: string, source: string) => {
    calls.push([from, source]);
    return source;
  };
  const expected = previous(imports, exports, resolve(beforeCalls));
  const actual = findLargeBarrels(imports, exports, new Set(), resolve(afterCalls));
  expect(actual).toEqual(expected);
  expect(afterCalls).toEqual(beforeCalls);
  return actual;
}

test.each([0, 1, 99, 100, 101, 160])(
  "packed graph handles %i root targets without source-ID staging capacity",
  (count) => {
    const exports = Array.from({ length: count }, (_, i) => ({
      relativePath: "root.ts",
      source: `package:p${i}`,
      line: i + 7,
      column: 3,
    }));
    const findings = compare([], exports);
    expect(findings).toEqual(
      count > 100 ? [{ relativePath: "root.ts", line: 7, column: 3, sourceCount: 101 }] : [],
    );
  },
);

test("enqueue stamps handle dense cycles, duplicate roots and interleaved importers", () => {
  const imports = Array.from({ length: 160 * 4 }, (_, i) =>
    makeImport(`f${i % 160}.ts`, `file:f${((i % 160) + Math.floor(i / 160) + 1) % 160}.ts`),
  );
  const exports = Array.from({ length: 8 }, (_, i) => ({
    relativePath: `f${i}.ts`,
    source: `file:f${i + 1}.ts`,
    line: i + 1,
    column: 1,
  }));
  expect(compare([...imports, ...imports], [...exports, ...exports])).toHaveLength(8);
});

test("file IDs do not alias leaf targets with the same raw name", () => {
  for (const filename of ["package:p", "relative:p", "file:p", "", "a|b.ts"]) {
    const exports = [
      { relativePath: filename, source: filename, line: 7, column: 3 },
      ...Array.from({ length: 100 }, (_, i) => ({
        relativePath: filename,
        source: `package:leaf${i}`,
        line: i + 8,
        column: 1,
      })),
    ];
    expect(compare([], exports)).toHaveLength(1);
  }
});

test("dynamic imports do not resolve or contribute graph edges", () => {
  const imports = Array.from({ length: 110 }, (_, i) =>
    makeImport("child.ts", `package:p${i}`, true),
  );
  expect(
    compare(imports, [{ relativePath: "root.ts", source: "file:child.ts", line: 1, column: 1 }]),
  ).toEqual([]);
  expect(compare(imports, [])).toEqual([]);
});

test("generation wrap clears stamps left by earlier roots", async () => {
  const filename = fileURLToPath(
    new URL("../src/repository-diagnostics/source-barrel-graph.ts", import.meta.url),
  );
  const sourceText = await Bun.file(filename).text();
  const checked = sourceText.replace("> 0xffffffff", "> 3");
  expect(checked).not.toBe(sourceText);
  const build = await Bun.build({
    entrypoints: [filename],
    target: "bun",
    plugins: [
      {
        name: "small-stamp-boundary",
        setup(builder) {
          builder.onLoad({ filter: /\/source-barrel-graph\.ts$/ }, () => ({
            contents: checked,
            loader: "ts",
          }));
        },
      },
    ],
  });
  expect(build.success).toBe(true);
  const bundled = await build.outputs[0]!.text();
  const { findLargeBarrels: wrapped } = await import(
    `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`
  );
  const exports = Array.from({ length: 5 }, (_rootValue, root) =>
    Array.from({ length: 101 }, (_leafValue, leaf) => ({
      relativePath: `root${root}.ts`,
      source: `package:group${root === 3 ? 0 : root}/leaf${leaf}`,
      line: root + 1,
      column: 1,
    })),
  ).flat();
  expect(wrapped([], exports, new Set(), (_from: string, source: string) => source)).toEqual(
    previous([], exports, (_from, source) => source),
  );
});

test("generated graphs preserve the string graph and all resolver calls", () => {
  const filename = fc.integer({ min: 0, max: 159 }).map((i) => `f${i}.ts`);
  const target = fc
    .tuple(fc.constantFrom("file:", "package:", "relative:", ""), filename)
    .map(([prefix, name]) => prefix + name);
  fc.assert(
    fc.property(
      fc.array(fc.tuple(filename, target, fc.boolean()), { minLength: 20, maxLength: 300 }),
      fc.array(
        fc.record({
          relativePath: filename,
          source: target,
          line: fc.integer({ min: 1, max: 30 }),
          column: fc.integer({ min: 1, max: 10 }),
        }),
        { maxLength: 20 },
      ),
      (imports, exports) => {
        compare(
          imports.map(([from, source, dynamic]) =>
            makeImport(from, source, dynamic ? true : undefined),
          ),
          exports,
        );
      },
    ),
    { numRuns: 500, seed: 20261115 },
  );
});
