import { describe, expect, test } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import { parseDocument, isMap } from "../src/yaml.ts";
import { formatComplexKey, type KeyFormatting } from "../src/yaml-key-stringifier.ts";
import { captureYamlWarnings, compareDocumentConversion } from "./yaml-document-test-helpers.ts";

const cases = [
  "[yes, NO, On, off, y, N, true, FALSE]",
  "[012, -012, -0b1010, +0xA_F, 1_000, 1:20, -0:21, 123:45:56.120]",
  "[1.200, 1_2.0_0, 1e3, .NaN, -.Inf]",
  "[!!str yes, !!str true, !!str 012, !!int '42', !!float 1.0, !!null '', !!bool 'false']",
  "[!!timestamp 2026-11-07, !!timestamp '2026-11-07T12:34:56.123+02:30']",
  "[!!binary aGVsbG8=, !!binary '7777']",
  `[!!binary ${Buffer.alloc(100, 97).toString("base64")}]`,
  `[[[{!!binary '${Buffer.alloc(150, 97).toString("base64")}': output}]]]`,
  `!!pairs [{!!binary '${Buffer.alloc(150, 97).toString("base64")}': output}]`,
  `!!omap [{first: !!binary '${Buffer.alloc(150, 97).toString("base64")}'}]`,
  "[!custom value, !<tag:example.org,2026:item> value, !e!item yes]",
  "[!e!punct%2Citem [one, two], !e!space%20item value]",
  "[!!set {one, two}, !!omap [{first: one}, {second: two}], !!pairs [{first: one}, {first: two}]]",
  "!!set {one, two}",
  "!!omap [{first: one}, {second: two}]",
  "!!pairs [{first: one}, {first: two}]",
  "&root !!set {*root}",
  "&root !!omap [{self: *root}]",
  "[&item !e!thing [one], *item]",
  ...["pairs", "omap"].flatMap((tag) =>
    [true, false].map((key) => {
      const binary = `!!binary ${Buffer.alloc(31, 97).toString("base64")}`;
      let body = `!!${tag} [{${key ? `${binary}: output` : `first: ${binary}`}}]`;
      // Deep pair indentation exposed a chunk boundary absent from shallow cases.
      for (let depth = 0; depth < 9; depth++) {
        body = depth % 2 ? `{nested: ${body}}` : `[${body}]`;
      }
      return body;
    }),
  ),
];

describe("owned schema/tag key formatting", () => {
  for (const version of ["1.1", "1.2"]) {
    test.each(cases)(
      `YAML ${version} tags and scalar formats need no native formatter: %s`,
      (body) => {
        const source = `%YAML ${version}\n%TAG !e! tag:example.org,2026:\n---\n? ${body}\n: output\n`;
        const reference = referenceParse(source);
        const actual = parseDocument(source);
        expect(actual.errors).toEqual([]);
        if (!isMap(actual.contents)) {
          throw new Error("Expected complex-key mapping");
        }
        const node = actual.contents.items[0]?.key;
        if (!node) {
          throw new Error("Expected key node");
        }
        const formatting: KeyFormatting = {
          schema: reference.schema.name,
          tagPrefixes: { ...reference.directives.tags },
          schemaTags: reference.schema.tags.map((tag) => ({
            tag: tag.tag,
            default: tag.default ?? false,
            format: tag.format,
          })),
        };
        const expected = captureYamlWarnings(() => reference.toJS()).result as Record<
          string,
          unknown
        >;
        const anchors = [node];
        if (body.startsWith("[&item") && "items" in node) {
          const item = node.items[0];
          if (item && "anchor" in item) {
            anchors.push(item);
          }
        }
        expect(formatComplexKey(node, anchors, formatting)).toBe(Object.keys(expected)[0]!);
        compareDocumentConversion(source, [0, 2, 100]);
      },
    );
  }

  test.each([
    "[!!str [one], !!binary [one], !!timestamp {one: two}]",
    "[!!binary [one], !!binary aGVsbG8=]",
    "[!!binary aGVsbG8=, !!binary [one]]",
    "[!!timestamp {one: two}, !!timestamp 2026-11-07]",
    "[!!timestamp 2026-11-07, !!timestamp {one: two}]",
    "[!!int {one: two}, !!bool [one]]",
    "[!!set {one: 1}, !!omap {first: one}]",
    "[!!set [one], !!pairs {first: one}]",
    "[!!omap [{first: one}, {first: two}]]",
  ])("malformed tags preserve existing conversion/error behavior: %s", (body) => {
    for (const version of ["1.1", "1.2"]) {
      compareDocumentConversion(`%YAML ${version}\n---\n? ${body}\n: output`, [0, 2, 100]);
    }
  });
});
