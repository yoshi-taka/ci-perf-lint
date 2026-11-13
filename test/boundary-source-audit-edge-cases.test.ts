import { expect, test } from "bun:test";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";
import { findLargeBarrels } from "../src/repository-diagnostics/source-barrel-graph.ts";

const large = JSON.stringify(Array(51).fill("line").join("\n"));
const call = `expect(value).toMatchInlineSnapshot(${large});`;
test.each([
  `function f(expect=custom) { ${call} }`,
  `function f(...expect) { ${call} }`,
  `function f({...expect}) { ${call} }`,
  `function f([,expect]) { ${call} }`,
  `function f() { { var expect; } ${call} }`,
  `for(let expect of values) { ${call} }`,
  `for(let expect in values) { ${call} }`,
  `switch(value) { case 1: let expect=custom; ${call} }`,
  `class expect { static f() { ${call} } }`,
  `const f=function expect() { ${call} };`,
  `expect++; ${call}`,
  `({expect}=custom); ${call}`,
  `[expect]=custom; ${call}`,
  `for(expect of values) {} ${call}`,
  `for(expect in values) {} ${call}`,
])("Jest provenance rejects shadowed/written bindings: %s", async (source) => {
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toEqual([]);
});

test.each([
  `function unrelated() {} ${call}`,
  `class Unrelated {} ${call}`,
  `const Unrelated=class expect {}; ${call}`,
  `const f=function expect() {}; ${call}`,
  `function f([,unrelated]) {} ${call}`,
  `const unrelated={}; unrelated.x++; ${call}`,
  `expect(value)["toMatchInlineSnapshot"](${large});`,
  `import {"expect" as check} from "@jest/globals"; check(value).toMatchInlineSnapshot(${large});`,
  `import type {expect} from "@jest/globals"; ${call}`,
])("unrelated bindings and supported Jest syntax retain detection: %s", async (source) => {
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toHaveLength(1);
});

test.each([
  `expect(value)[method](${large});`,
  `expect(value)[1](${large});`,
  `expect(value).toMatchInlineSnapshot();`,
  `expect(value).toMatchInlineSnapshot({}, ${large}, other);`,
  `expect(value).toThrowErrorMatchingInlineSnapshot({}, ${large});`,
  `expect(value).toMatchInlineSnapshot(variable);`,
  `import expect from "other-library"; ${call}`,
  `import * as expect from "other-library"; ${call}`,
])("non-static/unsupported matcher syntax is not guessed: %s", async (source) => {
  expect((await parseSourceAudit("a.test.ts", source))!.snapshots).toEqual([]);
});

async function barrels(files: Record<string, string>) {
  const facts = await Promise.all(
    Object.entries(files).map(async ([file, source]) => {
      const parsed = await parseSourceAudit(file, source);
      expect(parsed).toBeDefined();
      return parsed!;
    }),
  );
  return findLargeBarrels(
    facts.flatMap((f) => f.imports),
    facts.flatMap((f) => f.wildcardExports),
    new Set(Object.keys(files)),
  );
}
const imports = Array.from({ length: 100 }, (_, index) => `import "external-${index}";`).join("\n");
test.each(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs"])(
  "barrel graph resolves extensionless %s subtrees",
  async (extension) => {
    expect(
      await barrels({
        "src/index.ts": 'export * from "./leaf";',
        [`src/leaf.${extension}`]: imports,
      }),
    ).toHaveLength(1);
  },
);
test.each(["ts", "tsx", "js"])(
  "barrel graph resolves directory index.%s subtrees",
  async (extension) => {
    expect(
      await barrels({
        "src/index.ts": 'export * from "./dir";',
        [`src/dir/index.${extension}`]: imports,
      }),
    ).toHaveLength(1);
  },
);
test.each([
  ["mjs", "mts"],
  ["cjs", "cts"],
  ["jsx", "tsx"],
])("barrel graph maps runtime .%s to source .%s", async (runtime, source) => {
  expect(
    await barrels({
      "src/index.ts": `export * from "./leaf.${runtime}";`,
      [`src/leaf.${source}`]: imports,
    }),
  ).toHaveLength(1);
});
test("ambiguous local targets stay leaves, exact paths win, and canonical paths deduplicate", async () => {
  expect(
    await barrels({
      "src/index.ts": 'export * from "./leaf";',
      "src/leaf.ts": imports,
      "src/leaf.js": "export {};",
    }),
  ).toEqual([]);
  expect(
    await barrels({
      "src/index.ts": 'export * from "./leaf.js";',
      "src/leaf.ts": imports,
      "src/leaf.js": "export {};",
    }),
  ).toEqual([]);
  const ninetyNine = Array.from({ length: 99 }, (_, index) => `import "external-${index}";`).join(
    "\n",
  );
  expect(
    await barrels({
      "src/index.ts":
        'export * from "./leaf.js"; export * from "./leaf.ts"; export * from "./dir/../leaf";',
      "src/leaf.ts": ninetyNine,
    }),
  ).toEqual([]);
  expect(
    await barrels({
      "src/index.ts": `export * from "./index";\n${Array.from({ length: 100 }, (_, i) => `export * from "external-${i}";`).join("\n")}`,
    }),
  ).toEqual([]);
});

test("extensionless CommonJS references deduplicate with exact .cjs paths", async () => {
  const prefix = Array.from({ length: 99 }, (_, i) => `export * from "external-${i}";`).join("\n");
  expect(
    await barrels({
      "src/index.ts": `${prefix}\nexport * from "./leaf"; export * from "./leaf.cjs";`,
      "src/leaf.cjs": "module.exports={};",
    }),
  ).toEqual([]);
});

test("string-literal import/export names and ignored comments remain precise", async () => {
  const facts = await parseSourceAudit(
    "a.ts",
    'import {"ReactComponent" as SVG} from "./image.svg"; export {"x-y" as renamed} from "date-fns";',
  );
  expect(facts!.imports.map((f) => f.names)).toEqual([["ReactComponent"], ["x-y"]]);
  expect((await parseSourceAudit("a.ts", "const x=1;"))!.wildcardExports).toEqual([]);
  expect(
    (await parseSourceAudit(
      "a.ts",
      '// prose eslint-disable no-restricted-imports\nimport {x} from "date-fns";',
    ))!.imports[0]?.restricted,
  ).toBe(true);
});
