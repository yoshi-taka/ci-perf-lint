import { expect, test } from "bun:test";
import { parseSourceAudit as parseSourceFile } from "../src/repository-diagnostics/source-audit-parser.ts";
import { findLargeBarrels } from "../src/repository-diagnostics/source-barrel-graph.ts";

async function parseSourceAudit(filename: string, source: string) {
  const parsed = await parseSourceFile(filename, source);
  return parsed
    ? {
        ...parsed,
        barrels: findLargeBarrels(parsed.imports, parsed.wildcardExports, new Set([filename])),
      }
    : undefined;
}

const snapshot = (lines: number) =>
  JSON.stringify(Array.from({ length: lines }, () => "line").join("\n"));

test.each([99, 100, 101])("barrel threshold counts %i distinct wildcard sources", async (count) => {
  const source = Array.from({ length: count }, (_, index) => `export * from "./m${index}";`).join(
    "\n",
  );
  const facts = await parseSourceAudit("src/index.ts", source);
  expect(facts!.barrels).toHaveLength(count > 100 ? 1 : 0);
  if (count > 100) {
    expect(facts!.barrels[0]).toMatchObject({ sourceCount: count, line: 1, column: 1 });
  }
});

test("duplicate wildcard sources do not inflate barrel size; type exports still affect type graphs", async () => {
  expect(
    (await parseSourceAudit(
      "src/index.ts",
      Array.from({ length: 120 }, () => `export * from "./same";`).join("\n"),
    ))!.barrels,
  ).toEqual([]);
  expect(
    (await parseSourceAudit(
      "src/index.d.ts",
      Array.from({ length: 101 }, (_, index) => `export type * from "./t${index}";`).join("\n"),
    ))!.barrels,
  ).toHaveLength(1);
});

test.each([60, 99])(
  "wildcard branches share one distinct-reference set for %i common leaves",
  async (count) => {
    const files: Record<string, string> = {
      "index.ts": 'export * from "./a"; export * from "./b";',
      "a.ts": Array.from({ length: count }, (_, i) => `import "./m${i}";`).join("\n"),
      "b.ts": Array.from({ length: count }, (_, i) => `import "./m${i}";`).join("\n"),
      ...Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`m${i}.ts`, "export const value=1;"]),
      ),
    };
    const facts = await Promise.all(
      Object.entries(files).map(([name, source]) => parseSourceFile(name, source)),
    );
    const barrels = findLargeBarrels(
      facts.flatMap((f) => f!.imports),
      facts.flatMap((f) => f!.wildcardExports),
      new Set(Object.keys(files)),
    );
    expect(barrels).toHaveLength(count + 2 > 100 ? 1 : 0);
    if (count === 99) {
      expect(barrels[0]?.sourceCount).toBe(101);
    }
  },
);

test.each(["eslint", "oxlint"])(
  "%s barrel disable works at file and declaration level",
  async (prefix) => {
    const source = Array.from({ length: 101 }, (_, index) => `export * from "./m${index}";`).join(
      "\n",
    );
    expect(
      (await parseSourceAudit(
        "src/index.ts",
        `/* ${prefix}-disable oxc/no-barrel-file */\n${source}`,
      ))!.barrels,
    ).toEqual([]);
    expect(
      (await parseSourceAudit(
        "src/index.ts",
        `// ${prefix}-disable-next-line oxc/no-barrel-file\n${source}`,
      ))!.barrels,
    ).toEqual([]);
    expect(
      (await parseSourceAudit(
        "src/index.ts",
        `/* ${prefix}-disable import/extensions */\n${source}`,
      ))!.barrels,
    ).toHaveLength(1);
  },
);

test.each([49, 50, 51])("inline snapshot threshold counts %i logical lines", async (lines) => {
  const facts = await parseSourceAudit(
    "src/a.test.ts",
    `expect(value).toMatchInlineSnapshot(${snapshot(lines)});`,
  );
  expect(facts!.snapshots).toHaveLength(lines > 50 ? 1 : 0);
  if (lines > 50) {
    expect(facts!.snapshots[0]).toMatchObject({ lineCount: lines, line: 1, column: 1 });
  }
});

test("accepts Jest aliases, static templates, property matchers and modifier chains", async () => {
  const large = snapshot(51);
  const source = [
    'import {expect as check} from "@jest/globals";',
    `check(value).toMatchInlineSnapshot({id:check.any(String)},${large});`,
    `expect(value).not.resolves.toThrowErrorMatchingInlineSnapshot(${large});`,
    `check(value)["toMatchInlineSnapshot"](${large});`,
    `check(value).toMatchInlineSnapshot(\`${Array.from({ length: 51 }, () => "line").join("\n")}\`);`,
  ].join("\n");
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toHaveLength(4);
});

test.each([
  "function run(expect) { EXPECT; }",
  "function run({expect}) { EXPECT; }",
  "function run() { EXPECT; const expect = custom; }",
  'import {expect} from "vitest"; EXPECT;',
  "const expect = custom; EXPECT;",
  "expect = custom; EXPECT;",
  "function run() { var expect; EXPECT; }",
  "try {} catch(expect) { EXPECT; }",
])("does not mistake shadowed or reassigned expect for Jest: %s", async (code) => {
  const source = code.replace("EXPECT", `expect(value).toMatchInlineSnapshot(${snapshot(51)})`);
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toEqual([]);
});

test("shadowing stays local; string mentions, dynamic templates, custom chains and non-inline matchers are ignored", async () => {
  const large = snapshot(51);
  const source = [
    `function local(expect) { expect(value).toMatchInlineSnapshot(${large}); }`,
    `expect(value).toMatchInlineSnapshot(${large});`,
    `custom(value).toMatchInlineSnapshot(${large});`,
    `expect(value).custom.toMatchInlineSnapshot(${large});`,
    `expect(value).toMatchSnapshot(${large});`,
    `expect(value).toMatchInlineSnapshot(\`${Array.from({ length: 51 }, () => "line").join("\n")}\${value}\`);`,
    `// expect(value).toMatchInlineSnapshot(\`${"line\\n".repeat(60)}\`);`,
  ].join("\n");
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toHaveLength(1);
});

test("snapshot suppression is independent of import suppression", async () => {
  const large = snapshot(51);
  const source = [
    "// eslint-disable-next-line jest/no-large-snapshots",
    `expect(value).toMatchInlineSnapshot(${large});`,
    "// oxlint-disable-next-line no-restricted-imports",
    `expect(value).toMatchInlineSnapshot(${large});`,
  ].join("\n");
  expect(
    (await parseSourceAudit("a.test.ts", source))!.snapshots.map((entry) => entry.line),
  ).toEqual([4]);
});

test("a one-line barrel can expose a large local import subtree, without double-counting cycles", async () => {
  const files = {
    "src/index.ts": 'export * from "./leaf.js";',
    "src/leaf.ts": [
      ...Array.from({ length: 101 }, (_, index) => `import {x as x${index}} from "./m${index}";`),
      'import {root} from "./index";',
    ].join("\n"),
  };
  const parsed = await Promise.all(
    Object.entries(files).map(([filename, source]) => parseSourceFile(filename, source)),
  );
  const findings = findLargeBarrels(
    parsed.flatMap((facts) => facts!.imports),
    parsed.flatMap((facts) => facts!.wildcardExports),
    new Set(Object.keys(files)),
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ relativePath: "src/index.ts", sourceCount: 101 });
  const cyclic = await Promise.all([
    parseSourceFile("src/a.ts", 'export * from "./b";'),
    parseSourceFile("src/b.ts", 'export * from "./a";'),
  ]);
  expect(
    findLargeBarrels(
      cyclic.flatMap((facts) => facts!.imports),
      cyclic.flatMap((facts) => facts!.wildcardExports),
      new Set(["src/a.ts", "src/b.ts"]),
    ),
  ).toEqual([]);
});
