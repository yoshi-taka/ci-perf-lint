import { describe, expect, test } from "bun:test";
import { parseDocument, isScalar, isSeq } from "../src/yaml.ts";
import { Alias, Pair, Scalar, YAMLMap, YAMLSeq } from "../src/yaml-ast.ts";
import { convertDocument } from "../src/yaml-document.ts";
import { compareDocumentConversion as compare } from "./yaml-document-test-helpers.ts";

describe("owned YAML document conversion", () => {
  test("synthetic AST conversion has no parser dependency and preserves cycles", () => {
    const map = new YAMLMap();
    map.anchor = "root";
    const sequence = new YAMLSeq();
    sequence.items.push(new Alias("root"));
    map.items.push(new Pair(new Scalar("self"), sequence));
    const result = convertDocument(map) as { self: unknown[] };
    expect(result.self[0]).toBe(result);
    expect(() => convertDocument(map, { maxAliasCount: 0 })).toThrow(
      "Alias resolution is disabled",
    );
    const mapped = convertDocument(map, { mapAsMap: true }) as Map<string, unknown[]>;
    expect(mapped.get("self")?.[0]).toBe(mapped);
  });

  test("ordinary document conversion observes owned scalar mutations and starts fresh each call", () => {
    const document = parseDocument("value: &a original\ncopy: *a\n");
    const scalar = document.get("value", true);
    if (!isScalar(scalar)) {
      throw new Error("Expected scalar");
    }
    scalar.value = "changed";
    expect(document.toJS()).toEqual({ value: "changed", copy: "changed" });
    expect(document.toJSON()).toEqual({ value: "changed", copy: "changed" });
    expect(() => document.toJS({ maxAliasCount: 1 })).toThrow("Excessive alias count");
    expect(document.toJS({ maxAliasCount: 2 })).toEqual({ value: "changed", copy: "changed" });
  });

  test("alias lookup is rebuilt from current AST order on every conversion", () => {
    const document = parseDocument("- &a 1\n- *a\n");
    if (!isSeq(document.contents)) {
      throw new Error("Expected sequence");
    }
    expect(document.toJS()).toEqual([1, 1]);
    document.contents.items.reverse();
    expect(() => document.toJS()).toThrow("Unresolved alias");
    document.contents.items.reverse();
    const scalar = document.get(0, true);
    const alias = document.get(1, true);
    if (!isScalar(scalar) || !(alias instanceof Alias)) {
      throw new Error("Expected scalar and alias");
    }
    scalar.anchor = "changed";
    expect(() => document.toJSON()).toThrow("Unresolved alias");
    alias.source = "changed";
    expect(document.toJSON()).toEqual([1, 1]);
  });

  test("complex keys retain backend YAML semantics while mapAsMap retains object keys", () => {
    // Upstream tests/doc/parse.ts 'handling complex keys'. Stringification and
    // its process warning deliberately remain backend responsibilities for now.
    const document = parseDocument("[foo]: bar");
    expect(document.toJS({ mapAsMap: true })).toEqual(new Map([[["foo"], "bar"]]));
  });

  // Adapted from eemeli/yaml v2.8.1 tests/doc/anchors.ts: basic,
  // re-defined anchor, circular reference, __proto__ as anchor name.
  // https://github.com/eemeli/yaml/blob/v2.8.1/tests/doc/anchors.ts
  test.each([
    ["- &a 1\n- *a\n", [1, 1]],
    ["- &a 1\n- &a 2\n- *a\n", [1, 2, 2]],
    ["- &__proto__ 1\n- *__proto__\n", [1, 1]],
    ["a: &anchor\nb: *anchor", { a: null, b: null }],
  ])("upstream anchor regression: %s", (source, expected) => {
    expect(parseDocument(source).toJS()).toEqual(expected);
    compare(source);
  });

  test("upstream circular reference retains the root identity", () => {
    const result = parseDocument("&a [ 1, *a ]\n").toJS() as unknown[];
    expect(result[1]).toBe(result);
    compare("&a [ 1, *a ]\n");
  });

  // Upstream tests/doc/parse.ts, 'Excessive entity expansion attacks' /
  // 'maxAliasCount limits'. Preserve its exact generated inputs and thresholds.
  // https://github.com/eemeli/yaml/blob/v2.8.1/tests/doc/parse.ts
  test("upstream amplification thresholds are exact, not just a rough alias cap", () => {
    const rows = [
      "a: &a [lol, lol, lol, lol, lol, lol, lol, lol, lol]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b]",
      "d: &d [*c, *c]",
      "e: [*d]",
    ];
    expect(() => parseDocument(rows[0]!).toJS({ maxAliasCount: 1 })).not.toThrow();
    for (const [index, limit] of [10, 50, 150, 300].entries()) {
      const source = rows.slice(0, index + 2).join("\n");
      expect(() => parseDocument(source).toJS({ maxAliasCount: limit - 1 })).toThrow(
        "Excessive alias count",
      );
      expect(() => parseDocument(source).toJS({ maxAliasCount: limit })).not.toThrow();
      compare(source, [0, limit - 1, limit, -1]);
    }
  });

  test.each([
    "- *a\n- &a 1\n", // forward aliases must not resolve
    "- &a [*a, *a]\n- &a {value: 2}\n- *a\n",
    "&a {self: *a, value: 1}\n",
    "&key name: *key\n", // anchors can appear on mapping keys
    "- &a []\n- *a\n- *a\n", // empty collections have zero amplification
    "- &a {}\n- *a\n",
    "- &a null\n- *a\n",
    "? null\n: value\n__proto__: data\nconstructor: own\n",
    "date: &date !!timestamp 2026-11-06\ncopy: *date\n",
    "bytes: &bytes !!binary aGVsbG8=\ncopy: *bytes\n",
    "base: &base {x: 1}\ncopy: {<<: *base}\n",
    "- &a !!set {first: null, second: null}\n- *a\n",
    "- &a !!omap [{first: one}, {second: two}]\n- *a\n",
    "- &a !!pairs [{first: one}, {first: two}]\n- *a\n",
    "%YAML 1.1\n---\nbase: &base {x: 1}\ncopy: {<<: *base, y: 2}\n",
  ])("values, identity and errors match under all consumed options: %s", (source) => {
    compare(source, [-1, 0, 1, 2, 3, 100]);
  });
});
