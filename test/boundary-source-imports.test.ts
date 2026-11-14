import { expect, test } from "bun:test";
import { collectSourceAudit } from "../src/repository-diagnostics/source-audit.ts";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";
import {
  importAuditDecisions,
  importSourceShape,
} from "../src/repository-diagnostics/source-import-policy.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();

async function parseSourceImports(filename: string, source: string) {
  return (await parseSourceAudit(filename, source))?.imports;
}

test.each([
  ['import { x } from "date-fns";', true, false, ["x"], false],
  ['import x from "date-fns";', true, false, ["default"], false],
  ['import * as x from "date-fns";', true, false, [], true],
  ['import { type X, x as y } from "date-fns";', true, false, ["x"], false],
  ['import type X from "date-fns";', false, false, [], false],
  ['import type {} from "./x";', false, false, [], false],
  ['import { type X } from "./x";', false, false, [], false],
  ['export type { X } from "./x";', false, false, [], false],
  ['export type * from "./x";', false, false, [], false],
  ['export { type X, x as y } from "./x";', true, true, ["x"], false],
  ['export * from "./x";', true, true, [], true],
  ['export * as ns from "./x";', true, true, [], true],
  ['import "./setup";', false, true, [], false],
  ['import { x } from "./x.ts";', true, false, ["x"], false],
  ['import { x } from "./x?raw";', true, false, ["x"], false],
] as const)(
  "extracts static module facts: %s",
  async (source, restricted, extensions, names, namespace) => {
    const facts = await parseSourceImports("src/a.ts", source);
    expect(facts).toHaveLength(1);
    expect(facts![0]).toMatchObject({
      restricted,
      extensions,
      names: [...names],
      namespace,
      line: 1,
      column: 1,
    });
  },
);

test("does not interpret strings, comments, require, or local exports as imports", async () => {
  const source = [
    '// import { x } from "date-fns";',
    'const text = `import { x } from "date-fns"`;',
    'const x = require("date-fns");',
    "export { x };",
  ].join("\n");
  expect(await parseSourceImports("src/a.ts", source)).toEqual([]);
  expect(await parseSourceImports("src/b.ts", "import { broken")).toBeUndefined();
});

test("exporting a local imported binding does not duplicate or relocate the import", async () => {
  const facts = await parseSourceImports(
    "src/a.ts",
    'import {format} from "date-fns";\nexport {format};\nexport {format as other};',
  );
  expect(facts).toHaveLength(1);
  expect(facts![0]).toMatchObject({ source: "date-fns", line: 1 });
});

test("locations count UTF-16 columns and CRLF lines correctly", async () => {
  const facts = await parseSourceImports(
    "src/a.ts",
    '// 日本語😀\r\nconst emoji = "😀"; import {x} from "date-fns";',
  );
  expect(facts![0]).toMatchObject({ line: 2, column: 21 });
});

test.each(["\r", "\u2028", "\u2029"])(
  "all ECMAScript line terminators preserve suppression and positions: %j",
  async (eol) => {
    const facts = await parseSourceImports(
      "a.ts",
      [
        "// eslint-disable-next-line no-restricted-imports",
        '  import {a} from "date-fns";',
        'import {b} from "date-fns";',
      ].join(eol),
    );
    expect(facts!.map(({ line, column, restricted }) => ({ line, column, restricted }))).toEqual([
      { line: 2, column: 3, restricted: false },
      { line: 3, column: 1, restricted: true },
    ]);
  },
);

test.each(["eslint", "oxlint"])(
  "respects scoped %s directives without treating string contents as comments",
  async (prefix) => {
    const source = [
      `// ${prefix}-disable-next-line no-restricted-imports -- deliberate`,
      'import {a} from "./one";',
      `/* ${prefix}-disable import/extensions */`,
      'import {b} from "./two";',
      `/* ${prefix}-enable import/extensions */`,
      `import {c} from "./three"; // ${prefix}-disable-line no-restricted-imports`,
      `const text = "${prefix}-disable";`,
      'import {d} from "./four";',
      `/* ${prefix}-disable */`,
      'import {e} from "./five";',
      `/* ${prefix}-enable no-restricted-imports */`,
      'import {f} from "./six";',
      `/* ${prefix}-enable */`,
      'import {g} from "./seven";',
    ].join("\n");
    expect(
      (await parseSourceImports("src/a.ts", source))!.map(({ restricted, extensions }) => [
        restricted,
        extensions,
      ]),
    ).toEqual([
      [false, true],
      [true, false],
      [false, true],
      [true, true],
      [false, false],
      [true, false],
      [true, true],
    ]);
  },
);

test("per-rule enables do not enable the other family; unrelated rules do not suppress imports", async () => {
  const source = [
    "/* eslint-disable no-console */",
    'import {a} from "./one";',
    "/* eslint-disable eslint/no-restricted-imports, import-x/extensions */",
    'import {b} from "./two";',
    "/* eslint-enable import/extensions */",
    'import {c} from "./three";',
  ].join("\n");
  expect(
    (await parseSourceImports("a.ts", source))!.map(({ restricted, extensions }) => [
      restricted,
      extensions,
    ]),
  ).toEqual([
    [true, true],
    [false, false],
    [false, true],
  ]);
});

test.each([
  ["./foo", true, false, false],
  ["../foo", true, false, false],
  [".", true, false, false],
  ["..", true, false, false],
  ["./dir.with.dot/foo", true, false, false],
  ["./dir.ts/", true, false, false],
  ["./foo.ts", true, true, false],
  ["./foo?raw", true, false, true],
  ["./foo#part", true, false, true],
  ["@/foo", false, false, false],
  ["node:fs", false, false, false],
  ["date-fns", false, false, false],
] as const)("classifies source shape %s", (source, relative, hasExtension, hasQuery) => {
  expect(importSourceShape(source)).toEqual({ relative, hasExtension, hasQuery });
});

test("all 128 eligibility inputs agree with an independent decision table", () => {
  for (let bits = 0; bits < 128; bits++) {
    const [
      runtime,
      hasBindings,
      relative,
      hasExtension,
      hasQuery,
      restrictedSuppressed,
      extensionsSuppressed,
    ] = [1, 2, 4, 8, 16, 32, 64].map((mask) => Boolean(bits & mask)) as [
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
    ];
    const actual = importAuditDecisions({
      runtime,
      hasBindings,
      relative,
      hasExtension,
      hasQuery,
      restrictedSuppressed,
      extensionsSuppressed,
    });
    expect(actual.restricted).toBe([runtime, hasBindings, !restrictedSuppressed].every(Boolean));
    expect(actual.extensions).toBe(
      [runtime, relative, !hasExtension, !hasQuery, !extensionsSuppressed].every(Boolean),
    );
  }
});

test("scans once per context, ignores artifacts, reports unsupported/invalid files, and does not cache across contexts", async () => {
  const root = await tempDirs.create("apl-source-imports-");
  await writeRepositoryFiles(root, {
    "src/a.ts": 'import { x } from "date-fns";',
    "fixtures/a.ts": 'import { x } from "date-fns";',
    "out/a.ts": 'import { x } from "date-fns";',
    "src/broken.ts": "import {broken",
    "src/App.vue": '<script setup>import {x} from "date-fns"</script>',
  });
  const warnings: ConstructorParameters<typeof RepositoryScanContext>[1] = [];
  const context = new RepositoryScanContext(root, warnings);
  const first = collectSourceAudit(context);
  expect(collectSourceAudit(context)).toBe(first);
  expect((await first).imports.map((entry) => entry.relativePath).sort()).toEqual([
    "src/App.vue",
    "src/a.ts",
  ]);
  expect(
    warnings.some(
      (warning) =>
        warning.source === "source-audit" &&
        warning.message.includes("0 Vue/Svelte/Astro files and 1 JS/TS read/parse failures"),
    ),
  ).toBe(true);
  await writeRepositoryFiles(root, { "src/a.ts": 'import {y} from "lodash-es";' });
  const rescan = await collectSourceAudit(new RepositoryScanContext(root, []));
  expect(rescan.imports.find((entry) => entry.relativePath === "src/a.ts")?.source).toBe(
    "lodash-es",
  );
});

test("shared source scan retains more than 2MiB of facts without truncating the tail", async () => {
  const root = await tempDirs.create("apl-source-large-output-");
  const count = 17_000;
  await writeRepositoryFiles(root, {
    "src/large.ts": Array.from(
      { length: count },
      (_, index) => `import {format as value${index}} from "date-fns";`,
    ).join("\n"),
  });
  const warnings: ConstructorParameters<typeof RepositoryScanContext>[1] = [];
  const audit = await collectSourceAudit(new RepositoryScanContext(root, warnings));
  expect(audit.imports).toHaveLength(count);
  expect(JSON.stringify(audit.imports).length).toBeGreaterThan(2 * 1024 * 1024);
  expect(audit.imports.at(-1)).toMatchObject({
    line: count,
    names: ["format"],
    restricted: true,
  });
  expect(warnings).toEqual([]);
}, 15000);
