import { expect, test } from "bun:test";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectSourceAudit } from "../src/repository-diagnostics/source-audit.ts";
import { extractSfcScripts } from "../src/repository-diagnostics/source-sfc.ts";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";
import fc from "fast-check";

const dirs = createTempDirTracker();
async function audit(extension: string, source: string) {
  const root = await dirs.create("apl-static-sfc-");
  await writeRepositoryFiles(root, { [`Component.${extension}`]: source });
  const context = new RepositoryScanContext(root, []);
  return { result: await collectSourceAudit(context), warnings: context.warnings };
}

test("component framework compilers are not package dependencies", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    expect(manifest[field]?.["@vue/compiler-sfc"]).toBeUndefined();
    expect(manifest[field]?.svelte).toBeUndefined();
    expect(manifest[field]?.["@astrojs/compiler"]).toBeUndefined();
  }
});

test("Svelte snippet parameters and spread attributes keep import locations", async () => {
  const source = [
    '{#snippet row({value=import("default")})}',
    '<p {...{value: import("spread")}} {value}>{import("body")}</p>',
    "{/snippet}",
    '{@render row(import("render"))}',
  ].join("\r\n");
  const { result, warnings } = await audit("svelte", source);
  expect(result.imports.map((row) => row.source)).toEqual(["default", "spread", "body", "render"]);
  for (const row of result.imports) {
    expect(source.split("\r\n")[row.line - 1]!.slice(row.column - 1)).toStartWith("import(");
  }
  expect(
    warnings.some((row) => /bindings not audited|attributes not audited/.test(row.message)),
  ).toBe(false);
});

test("Svelte await bindings and header separators ignore strings and comments", async () => {
  const { result } = await audit(
    "svelte",
    [
      '{#each [" as ", import("items")] /* as fake */ as item (import("key"))}{/each}',
      '{#await import("promise") then {value=import("inline-default")}}',
      '{:catch {error=import("catch-default")}}{import("catch-body")}{/await}',
      '{#await promise}{:then {value=import("then-default")}}{/await}',
    ].join("\n"),
  );
  expect(result.imports.map((row) => row.source)).toEqual([
    "items",
    "key",
    "promise",
    "inline-default",
    "catch-default",
    "catch-body",
    "then-default",
  ]);
});

test("Vue v-for and slot bindings audit defaults and their expression sources", async () => {
  const { result } = await audit(
    "vue",
    `<template>
<p v-for="({value=import('default')}, index) of import('items')">{{value}}</p>
<Child #default="{value=import('slot-default')}">{{import("body")}}</Child>
</template>`,
  );
  expect(result.imports.map((row) => row.source)).toEqual([
    "default",
    "items",
    "slot-default",
    "body",
  ]);
});

test("Astro frontmatter ignores fences in comments/strings and keeps independent scripts", async () => {
  const source = [
    "---",
    "const text = `",
    "---",
    "`;",
    "/*",
    "---",
    "*/",
    'import {expect as check} from "@jest/globals";',
    "---",
    '<p>{import("template")}</p>',
    '<script>import("client");</script>',
  ].join("\r\n");
  const { result } = await audit("astro", source);
  expect(result.imports.map((row) => row.source)).toEqual(["@jest/globals", "template", "client"]);
  expect(result.imports.map((row) => row.line)).toEqual([8, 10, 11]);
});

test("Astro JSX fragments, nested markup and spread attributes are audited once", async () => {
  const source = `<main {...{data: import("spread")}}>
{true && <><section><p>{import("child")}</p><img src={import("image")}/></section></>}
</main>`;
  const { result } = await audit("astro", source);
  expect(result.imports.map((row) => row.source)).toEqual(["spread", "child", "image"]);
  for (const row of result.imports) {
    expect(source.split("\n")[row.line - 1]!.slice(row.column - 1)).toStartWith("import(");
  }
});

test("Astro nested JSX/attribute recursion remains bounded", async () => {
  const nested = `${"<p value={".repeat(80)}import("too-deep")${"}/>".repeat(80)}`;
  const result = await extractSfcScripts("Component.astro", `{${nested}}`);
  expect(result.units).toEqual([]);
  expect(result.incomplete.some((note) => note.includes("unsupported boundaries"))).toBe(true);
});

test("Astro quoted attribute braces, comments and styles do not become imports", async () => {
  const { result } = await audit(
    "astro",
    `<style>.x {content:"import('fake-style')"}</style>
<p title="{import('fake-attribute')}">{/* import("fake-comment") */}{import("real")}</p>`,
  );
  expect(result.imports.map((row) => row.source)).toEqual(["real"]);
});

test("Astro HTML void tags in expressions retain both outer and attribute imports", async () => {
  const source = '<p>{import("outer") && <img src={import("image")}>}</p>';
  const { result } = await audit("astro", source);
  expect(result.imports.map((row) => row.source)).toEqual(["outer", "image"]);
  for (const row of result.imports) {
    expect(source.slice(row.column - 1)).toStartWith("import(");
  }
});

test.each([
  ["svelte", '{#snippet\r\nrow({value=import("default")})}<p/>{/snippet}'],
  ["vue", "<template><button @click=\r\n\"import('event')\"/></template>"],
])("multiline %s scaffolds keep original diagnostic coordinates", async (extension, source) => {
  const { result } = await audit(extension, source);
  expect(result.imports).toHaveLength(1);
  const fact = result.imports[0]!;
  expect(fact.line).toBe(2);
  expect(source.split("\r\n")[fact.line - 1]!.slice(fact.column - 1)).toStartWith("import(");
});

test("Vue comments, custom blocks and v-pre never manufacture imports", async () => {
  const { result } = await audit(
    "vue",
    [
      '<i18n>{"text":"<script>import \\"fake-custom\\";</script>"}</i18n>',
      '<template><!-- <script>import "fake-comment";</script> -->',
      '<p v-pre>{{ import("fake-literal") }}</p>',
      '<p>{{ import("real-template") }}</p></template>',
      '<script>import "real-script";</script>',
    ].join("\n"),
  );
  expect(result.imports.map((row) => row.source)).toEqual(["real-template", "real-script"]);
});

test("Svelte quoted markup inside JS is never reinterpreted as a script", async () => {
  const { result } = await audit(
    "svelte",
    `<p>{'<script>import "fake";</script>'}</p><script>import "real";</script>`,
  );
  expect(result.imports.map((row) => row.source)).toEqual(["real"]);
});

test("a self-closing Vue template does not turn following root text into JS", async () => {
  const { result } = await audit(
    "vue",
    '<template/>{{import("fake")}}<script>import "real";</script>',
  );
  expect(result.imports.map((row) => row.source)).toEqual(["real"]);
});

test("Vue interpolation handles regex braces and nested template strings", async () => {
  const source =
    '<template><p>{{ /[}]/.test(x) ? `outer ${`inner ${import("real")}`}` : null }}</p></template>';
  const { result } = await audit("vue", source);
  expect(result.imports).toMatchObject([{ source: "real", column: source.indexOf("import") + 1 }]);
});

test("Svelte blocks, declarations and quoted attributes preserve imports and offsets", async () => {
  const source = [
    "{#if /[}]/.test(x)}",
    '{@const value = import("declaration")}',
    '<p title="prefix {import("attribute")}">{`outer ${import("body")}`}</p>',
    '{:else if import("condition")}{import("else-body")}{/if}',
  ].join("\n");
  const { result } = await audit("svelte", source);
  expect(result.imports.map((row) => row.source)).toEqual([
    "declaration",
    "attribute",
    "body",
    "condition",
    "else-body",
  ]);
  for (const row of result.imports) {
    const line = source.split("\n")[row.line - 1]!;
    expect(line.slice(row.column - 1)).toStartWith("import(");
  }
});

test("Vue dynamic directive arguments are extracted independently of values", async () => {
  const { result } = await audit(
    "vue",
    `<template><p :[import('argument')]="import('value')"/></template>`,
  );
  expect(result.imports.map((row) => row.source)).toEqual(["argument", "value"]);
});

test("Vue template preprocessing is visible but does not parse preprocessor text as JS", async () => {
  const { result, warnings } = await audit(
    "vue",
    '<template lang="pug">{{import("fake")}}</template><script>import "real";</script>',
  );
  expect(result.imports.map((row) => row.source)).toEqual(["real"]);
  expect(warnings.some((row) => row.message.includes("template preprocessing unavailable"))).toBe(
    true,
  );
});

test("Svelte each bindings and keys are audited with the iterable and body", async () => {
  const { result, warnings } = await audit(
    "svelte",
    '{#each import("items") as {value = import("default")}, index (import("key"))}<p>{import("body")}</p>{/each}',
  );
  expect(result.imports.map((row) => row.source)).toEqual(["items", "default", "key", "body"]);
  expect(warnings.some((row) => row.message.includes("bindings and keys not audited"))).toBe(false);
});

test.each([
  ["vue", '<template><p></template><script>import "fake";</script>'],
  ["svelte", '{#if x}<p>{/if}</p><script>import "fake";</script>'],
  ["svelte", '<script>import "one";</script><script>import "two";</script>'],
  ["vue", '<template><p>{{ "unterminated }}</p></template><script>import "fake";</script>'],
])("ambiguous or malformed %s boundaries fail closed", async (extension, source) => {
  const { result, warnings } = await audit(extension, source);
  expect(result.imports).toEqual([]);
  expect(
    warnings.some((row) => row.message.includes("syntax errors or unsupported boundaries")),
  ).toBe(true);
});

test.each(["vue", "svelte"])(
  "%s extraction limits expression count and nesting",
  async (extension) => {
    const expression = extension === "vue" ? '{{import("real")}}' : '{import("real")}';
    const source =
      extension === "vue"
        ? `<template>${expression.repeat(130)}</template>`
        : expression.repeat(130);
    const result = await extractSfcScripts(`Component.${extension}`, source);
    expect(result.units).toHaveLength(128);
    expect(result.incomplete).toContain("more than 128 template expressions");
    const nested = `${"(".repeat(70)}x${")".repeat(70)}`;
    const deep = extension === "vue" ? `<template>{{${nested}}}</template>` : `{${nested}}`;
    expect((await extractSfcScripts(`Component.${extension}`, deep)).units).toEqual([]);
  },
);

test("fuzz: quoted fake markup and braces never become script/import facts", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.constantFrom(
          "<script>",
          "</script>",
          "import('fake')",
          "{",
          "}",
          "`",
          "'",
          '"',
          "\\",
          "\r\n",
          "\u2028",
          "😀",
        ),
        { maxLength: 30 },
      ),
      fc.constantFrom("vue", "svelte"),
      async (pieces, extension) => {
        const literal = JSON.stringify(pieces.join(""));
        const markup =
          extension === "vue"
            ? `<template><p>{{${literal}}}</p></template>`
            : `<p>{${literal}}</p>`;
        const source = `${markup}<script>import "real";</script>`;
        const extracted = await extractSfcScripts(`Component.${extension}`, source);
        const imports: string[] = [];
        for (const unit of extracted.units) {
          const facts = await parseSourceAudit(
            `Component.${extension}`,
            unit.source,
            undefined,
            `Component${unit.extension}`,
          );
          imports.push(...(facts?.imports.map((row) => row.source) ?? []));
        }
        expect(imports).toEqual(["real"]);
      },
    ),
    { numRuns: 200, seed: 20261114 },
  );
});
