import { expect, test } from "bun:test";
import fc from "fast-check";
import { extractSfcScripts, type ScriptRegion } from "../src/repository-diagnostics/source-sfc.ts";
import { componentScriptRegions } from "../src/repository-diagnostics/source-sfc-components.ts";
import { astroScriptRegions } from "../src/repository-diagnostics/source-sfc-astro.ts";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";

// Independent oracle: the former full-length mask algorithm, including scaffolds.
function fullMask(source: string, region: ScriptRegion): string {
  const blank = source.replace(/[^\r\n\u2028\u2029]/g, " ");
  let masked =
    blank.slice(0, region.start) + source.slice(region.start, region.end) + blank.slice(region.end);
  for (const span of region.omit ?? []) {
    masked = `${masked.slice(0, span.start)}0${blank.slice(
      span.start + 1,
      span.end,
    )}${masked.slice(span.end)}`;
  }
  if (region.role === "template") {
    const prefix = region.prefix ?? (region.declaration ? "{" : region.statements ? "(()=>{" : "(");
    const suffix = region.suffix ?? (region.declaration ? "}" : region.statements ? "})()" : ")");
    if (region.start < prefix.length) {
      return blank;
    }
    masked = masked.padEnd(region.end + suffix.length, " ");
    masked =
      masked.slice(0, region.start - prefix.length) +
      prefix +
      masked.slice(region.start, region.end) +
      suffix +
      masked.slice(region.end + suffix.length);
  }
  return masked;
}

test("many small template units do not retain full-length markup masks", async () => {
  const source = `<p>${"🌟markup".repeat(4096)}</p>${Array(128).fill('{import("./entry")}').join("")}`;
  const scripts = await extractSfcScripts("Component.svelte", source);
  expect(scripts.units).toHaveLength(128);
  for (const unit of scripts.units) {
    expect(unit.positionOffset).toBeGreaterThan(0);
    expect(unit.source.length).toBeLessThan(32);
    expect(unit.source).not.toContain("markup");
  }
});

test.each(["\n", "\r\n", "\r", "\u2028", "\u2029"])(
  "compact scripts map suppressed imports and snapshots across %j",
  async (eol) => {
    const source = [
      "<template><p>🌟日本語</p></template>",
      "<script>",
      "// eslint-disable-next-line no-restricted-imports",
      'import {format} from "date-fns";',
      'import {addDays} from "date-fns";',
      `expect(1).toMatchInlineSnapshot(${JSON.stringify(Array(51).fill("line").join("\n"))});`,
      "</script>",
    ].join(eol);
    const unit = (await extractSfcScripts("Component.vue", source)).units[0]!;
    const facts = await parseSourceAudit("Component.vue", unit.source, undefined, {
      filename: "Component.vue.js",
      positionSource: source,
      positionOffset: unit.positionOffset,
    });
    expect(
      facts?.imports.map(({ line, column, restricted }) => ({ line, column, restricted })),
    ).toEqual([
      { line: 4, column: 1, restricted: false },
      { line: 5, column: 1, restricted: true },
    ]);
    expect(facts?.snapshots).toMatchObject([{ line: 6, column: 1, lineCount: 51 }]);
  },
);

test.each(["vue", "svelte", "astro"])(
  "%s compact scripts do not turn embedded hashbangs into initial hashbangs",
  async (extension) => {
    const source = '<script>#!node\nimport "./entry";</script>';
    const unit = (await extractSfcScripts(`Component.${extension}`, source)).units[0]!;
    expect(unit.source.startsWith("#!")).toBe(false);
    expect(
      await parseSourceAudit("Component", unit.source, undefined, "Component.js"),
    ).toBeUndefined();
  },
);

test.each(["vue", "svelte"])("%s shared captures keep absolute AST offsets", async (extension) => {
  const source =
    extension === "vue"
      ? '<script>import {expect} from "@jest/globals";</script><script setup>expect(1).toMatchInlineSnapshot(`x`)</script>'
      : '<script module>import {expect} from "@jest/globals";</script><script>expect(1).toMatchInlineSnapshot(`x`)</script>';
  const scripts = await extractSfcScripts(`Component.${extension}`, source);
  expect(scripts.sharedScope).toBe(true);
  for (const unit of scripts.units) {
    expect(unit.positionOffset).toBe(0);
    expect(unit.source.length).toBe(source.length);
    let start: number | undefined;
    await parseSourceAudit("Component", unit.source, undefined, "Component.js", (capture) => {
      start = capture.program.body[0]?.start;
    });
    expect(start).toBe(unit.start);
  }
});

test("Astro omitted JSX keeps whitespace, not letters from markup", async () => {
  const source = '<p>{items.map(x => <button return="nur2028">{import("./leaf")}</button>)}</p>';
  const scripts = await extractSfcScripts("Component.astro", source);
  expect(scripts.units.length).toBeGreaterThan(1);
  const imports: string[] = [];
  for (const unit of scripts.units) {
    expect(unit.source).not.toContain("nur2028");
    const facts = await parseSourceAudit("Component.astro", unit.source, undefined, {
      filename: "Component.astro.tsx",
      positionSource: source,
      positionOffset: unit.positionOffset,
    });
    expect(facts).toBeDefined();
    imports.push(...facts!.imports.map((entry) => entry.source));
  }
  expect(imports).toEqual(["./leaf"]);
});

test("generated compact units preserve full-mask facts and invalid syntax", async () => {
  let valid = 0;
  let invalid = 0;
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("vue", "svelte", "astro"),
      fc.constantFrom("\n", "\r\n", "\r", "\u2028", "\u2029"),
      fc.constantFrom("", "🌟日本語", "markup".repeat(256)),
      fc.constantFrom(
        'import {format} from "date-fns";\nexport * from "./leaf";',
        '// oxlint-disable-next-line import/extensions\nimport "./entry";',
        '/* eslint-disable no-restricted-imports */\nimport {format} from "date-fns";',
        'const lazy = () => import("./dynamic"); // trailing comment',
        `expect(1).toMatchInlineSnapshot(${JSON.stringify(Array(51).fill("line").join("\n"))});`,
        '#!node\nimport "./entry";',
        "const invalid =",
      ),
      fc.boolean(),
      async (extension, eol, markup, body, shared) => {
        const script = `<script>${body.replaceAll("\n", eol)}</script>`;
        const template =
          extension === "vue"
            ? `<template><p>${markup}{{import("./template")}}</p></template>`
            : `<p>${markup}{import("./template")}</p>`;
        const extra =
          !shared || extension === "astro"
            ? ""
            : extension === "vue"
              ? '<script setup>import "./second";</script>'
              : '<script module>import "./second";</script>';
        const source = template + script + extra;
        const regions = (
          extension === "astro"
            ? astroScriptRegions(source)
            : componentScriptRegions(source, extension === "svelte")
        ).regions.sort((a, b) => a.start - b.start);
        const scripts = await extractSfcScripts(`Component.${extension}`, source);
        expect(scripts.units).toHaveLength(regions.length);
        for (const [index, unit] of scripts.units.entries()) {
          const syntax = { filename: `Component${unit.extension}`, positionSource: source };
          const expected = await parseSourceAudit(
            "Component",
            fullMask(source, regions[index]!),
            undefined,
            syntax,
          );
          const actual = await parseSourceAudit("Component", unit.source, undefined, {
            ...syntax,
            positionOffset: unit.positionOffset,
          });
          expect(actual).toEqual(expected);
          if (expected) {
            valid++;
          } else {
            invalid++;
          }
        }
      },
    ),
    { numRuns: 500, seed: 20261115 },
  );
  expect(valid).toBeGreaterThan(0);
  expect(invalid).toBeGreaterThan(0);
});
