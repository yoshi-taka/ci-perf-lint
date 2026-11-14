import { expect, test } from "bun:test";
import fc from "fast-check";
import { parseSync, rawTransferSupported } from "oxc-parser";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";
import { findLargeBarrels } from "../src/repository-diagnostics/source-barrel-graph.ts";

const runs = Number(process.env.SOURCE_AUDIT_FUZZ_RUNS ?? 150);
const options = { numRuns: runs, interruptAfterTimeLimit: 15000, markInterruptAsFailure: true };
const lineEnding = fc.constantFrom("\n", "\r\n", "\r", "\u2028", "\u2029");

test("fuzz/differential: eager raw transfer preserves normal AST, metadata, comments and errors", () => {
  if (!rawTransferSupported()) {
    // Production uses normal transfer on unsupported platforms.
    expect(parseSync("fallback.ts", 'export * from "./entry";').errors).toEqual([]);
    return;
  }
  const rawOptions: NonNullable<Parameters<typeof parseSync>[2]> & {
    experimentalRawTransfer: boolean;
  } = { experimentalRawTransfer: true };
  const fragments = [
    'import type {} from "types";',
    'import {} from "empty";',
    'import {format as renamed, type Locale} from "date-fns";',
    'export {} from "./empty";',
    'export type * from "./types";',
    'export * as namespace from "./entry";',
    'export {renamed as format, type Locale} from "./entry";',
    'const emoji = "😀日本語"; import(`date-fns`);',
    'const dynamic = import /* gap */ ("./late");',
    "// oxlint-disable-next-line import/extensions",
    'import "./extensionless";',
    'import {expect as check} from "@jest/globals"; check(1).toMatchInlineSnapshot(`one\\ntwo`);',
    'const element = <div title="日本語">{import("./view")}</div>;',
    "class Example { #value = 1; accessor item = 2; }",
    "const broken = ;",
    "/* unterminated",
    'const invalid = "\\uD800";',
  ];
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...fragments), { minLength: 1, maxLength: 12 }),
      lineEnding,
      (parts, eol) => {
        const source = parts.join(eol);
        const normal = parseSync("transfer.tsx", source);
        const raw = parseSync("transfer.tsx", source, rawOptions);
        expect(raw.errors).toEqual(normal.errors);
        expect(raw.comments).toEqual(normal.comments);
        expect(raw.module).toEqual(normal.module);
        expect(raw.program).toEqual(normal.program);
      },
    ),
    options,
  );
});

test("fuzz: arbitrary UTF-16 source either parses safely or is explicitly rejected", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer({ min: 0, max: 65535 }), { maxLength: 1500 }),
      async (units) => {
        const facts = await parseSourceAudit("fuzz.ts", String.fromCharCode(...units));
        if (!facts) {
          return;
        }
        for (const entry of [...facts.imports, ...facts.wildcardExports, ...facts.snapshots]) {
          expect(Number.isInteger(entry.line) && entry.line > 0).toBe(true);
          expect(Number.isInteger(entry.column) && entry.column > 0).toBe(true);
        }
      },
    ),
    options,
  );
}, 20000);

test("fuzz/metamorphic: aliases, comments and JS line endings preserve scoped suppression", async () => {
  await fc.assert(
    fc.asyncProperty(
      lineEnding,
      fc.integer({ min: 0, max: 20 }),
      fc.constantFrom("eslint", "oxlint"),
      async (eol, spaces, prefix) => {
        const source = [
          `// ${prefix}-disable-next-line no-restricted-imports`,
          `${" ".repeat(spaces)}import {format as renamed} from "date-fns";`,
          '// a harmless comment containing import {x} from "ramda"',
          'import {addDays as another} from "date-fns";',
        ].join(eol);
        const facts = await parseSourceAudit("fuzz.ts", source);
        expect(facts).toBeDefined();
        expect(
          facts!.imports.map(({ line, column, restricted, names }) => ({
            line,
            column,
            restricted,
            names,
          })),
        ).toEqual([
          { line: 2, column: spaces + 1, restricted: false, names: ["format"] },
          { line: 4, column: 1, restricted: true, names: ["addDays"] },
        ]);
      },
    ),
    options,
  );
}, 20000);

test("fuzz/differential: random graph reachability matches an independent closure oracle", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 7 }),
      fc.array(fc.boolean(), { minLength: 49, maxLength: 49 }),
      fc.integer({ min: 94, max: 101 }),
      async (n, bits, baseline) => {
        const reached = new Set([0]);
        let changed = true;
        while (changed) {
          changed = false;
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              if (reached.has(i) && bits[i * n + j] && !reached.has(j)) {
                reached.add(j);
                changed = true;
              }
            }
          }
        }
        const parsed = [];
        for (let i = 0; i < n; i++) {
          const lines =
            i === 0
              ? Array.from({ length: baseline }, (_, index) => `export * from "external-${index}";`)
              : [];
          for (let j = 0; j < n; j++) {
            if (bits[i * n + j]) {
              lines.push(i === 0 ? `export * from "./n${j}";` : `import "./n${j}";`);
            }
          }
          const facts = await parseSourceAudit(`n${i}.ts`, lines.join("\n"));
          expect(facts).toBeDefined();
          parsed.push(facts!);
        }
        const imports = parsed.flatMap((facts) => facts.imports),
          wildcards = parsed.flatMap((facts) => facts.wildcardExports);
        const files = new Set(Array.from({ length: n }, (_, index) => `n${index}.ts`));
        const actual = findLargeBarrels(imports, wildcards, files).filter(
          (entry) => entry.relativePath === "n0.ts",
        );
        expect(actual.map((entry) => entry.sourceCount)).toEqual(
          baseline + reached.size - 1 > 100 ? [101] : [],
        );
        // Duplicating and reordering facts must not inflate reference counts.
        expect(
          findLargeBarrels(
            [...imports, ...imports].reverse(),
            [...wildcards, ...wildcards].reverse(),
            files,
          ).map(({ relativePath, sourceCount }) => ({ relativePath, sourceCount })),
        ).toEqual(actual.map(({ relativePath, sourceCount }) => ({ relativePath, sourceCount })));
      },
    ),
    options,
  );
}, 20000);

test("metamorphic: unrelated strings and comments do not alter import/snapshot meaning", async () => {
  const body = [
    'import {format} from "date-fns";',
    `expect(value).toMatchInlineSnapshot(${JSON.stringify(Array(51).fill("line").join("\n"))});`,
  ].join("\n");
  const normalize = (facts: NonNullable<Awaited<ReturnType<typeof parseSourceAudit>>>) => ({
    imports: facts.imports.map(({ source, names, restricted, extensions }) => ({
      source,
      names,
      restricted,
      extensions,
    })),
    snapshots: facts.snapshots.map(({ lineCount }) => lineCount),
  });
  const baseline = await parseSourceAudit("a.test.ts", body);
  expect(baseline!.imports).toHaveLength(1);
  expect(baseline!.snapshots).toHaveLength(1);
  for (const prefix of [
    "// eslint-disable no-console\n",
    'const harmless = "oxlint-disable";\n',
    '/* import {x} from "ramda" */\n',
    "\n\n",
  ]) {
    expect(normalize((await parseSourceAudit("a.test.ts", prefix + body))!)).toEqual(
      normalize(baseline!),
    );
  }
});
