import { describe, expect, test } from "bun:test";
import { parseDocument, isMap, isSeq, isScalar } from "../src/yaml.ts";
import { Pair, Scalar, type YAMLMap } from "../src/yaml-ast.ts";
import { compareDocumentConversion as compare } from "./yaml-document-test-helpers.ts";

const yaml11 = (source: string): string => `%YAML 1.1\n---\n${source}`;

describe("owned special YAML conversion", () => {
  // Actual upstream regressions, not just examples from the YAML specification:
  // https://github.com/eemeli/yaml/blob/v2.8.1/tests/doc/types.ts
  test.each([
    ["!!pairs\n- a: 1\n- b: 2\n- a: 3\n", [{ a: 1 }, { b: 2 }, { a: 3 }]],
    ["!!pairs [ a: 1, b: 2, a: 3 ]\n", [{ a: 1 }, { b: 2 }, { a: 3 }]],
    [
      "!!omap\n- a: 1\n- b: 2\n- c: 3\n",
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]),
    ],
    [
      "!!omap [ a: 1, b: 2, c: 3 ]\n",
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]),
    ],
    ["!!set\n? a\n? b\n? c\n", new Set(["a", "b", "c"])],
    ["!!set { a, b, c }\n", new Set(["a", "b", "c"])],
  ])("upstream tagged collection: %s", (source, expected) => {
    const document = parseDocument(yaml11(source));
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toEqual(expected);
    expect(document.toJSON()).toEqual(expected);
    compare(yaml11(source));
  });

  test.each([
    "!!omap\n- a: 1\n- b: 2\n- b: 9\n",
    "!!set\n? a\n? b\nc: d\n",
    "!!pairs [{a: 1, b: 2}, {}, scalar]\n",
    "!!omap [{a: 1, b: 2}, {}, scalar]\n",
  ])("malformed tags retain parse errors and conversion behavior: %s", (source) => {
    expect(parseDocument(yaml11(source)).errors.length).toBeGreaterThan(0);
    compare(yaml11(source));
  });

  test.each(["!!set [a, b]\n", "!!omap {a: 1}\n"])(
    "wrong-kind tags warn rather than reject: %s",
    (source) => {
      const document = parseDocument(yaml11(source));
      expect(document.errors).toEqual([]);
      expect(document.warnings.map((warning) => warning.code)).toEqual(["TAG_RESOLVE_FAILED"]);
      compare(yaml11(source));
    },
  );

  // Upstream tests/doc/anchors.ts, 'anchor on tagged collection'.
  test.each(["- &a !!set { 1, 2 }\n- *a\n", "- &a !!omap [ 1: 1, 2: 2 ]\n- *a\n"])(
    "tagged anchors preserve identity: %s",
    (source) => {
      const result = parseDocument(source).toJS() as unknown[];
      expect(result[1]).toBe(result[0]);
      compare(source, [-1, 0, 1, 2, 100]);
    },
  );

  test("set conversion and get operate on owned pairs, not native callbacks", () => {
    const document = parseDocument("!!set {first, second}");
    if (!isMap(document.contents)) {
      throw new Error("Expected set AST");
    }
    expect(document.get("first")).toBe("first");
    expect(document.get("first", true)).toBe(document.contents.items[0]);
    const mutable: YAMLMap = document.contents;
    mutable.items.push(new Pair(new Scalar("third"), null));
    expect(document.toJS()).toEqual(new Set(["first", "second", "third"]));
    expect(document.contents.toJSON()).toEqual(new Set(["first", "second", "third"]));
  });

  test("ordered maps retain node-only arrays, keyed get and document duplicate rejection", () => {
    const document = parseDocument("!!omap [{first: one}, {second: two}]");
    if (!isSeq(document.contents)) {
      throw new Error("Expected ordered-map AST");
    }
    const value = document.get("first", true);
    if (!isScalar(value)) {
      throw new Error("Expected scalar");
    }
    value.value = "changed";
    expect(document.get("first")).toBe("changed");
    expect(document.contents.toJSON()).toEqual([{ first: "changed" }, { second: "two" }]);
    expect(document.toJS()).toEqual(
      new Map([
        ["first", "changed"],
        ["second", "two"],
      ]),
    );
    document.contents.items.push(document.contents.items[0]!);
    expect(() => document.toJS()).toThrow("Ordered maps must not include duplicate keys");
  });

  test("cyclic set keys use owned conversion rather than complex-key fallback", () => {
    const document = parseDocument("&a !!set {*a}");
    if (!isMap(document.contents)) {
      throw new Error("Expected set AST");
    }
    const result = document.toJS() as Set<unknown>;
    expect(result.has(result)).toBe(true);
    document.contents.items.pop();
    expect(document.toJS()).toEqual(new Set());
  });

  // Upstream tests/doc/anchors.ts 'merge <<' / non-alias merges, adapted by
  // using the consumed YAML 1.1 directive rather than an unexposed merge option.
  test.each([
    ["{ <<: { a: A }, b: B }", { a: "A", b: "B" }],
    ["{ <<: [{ a: A }, { b: B }], c: C }", { a: "A", b: "B", c: "C" }],
    ["{ <<: [{ a: &a { A: 1 } }, *a], b: B }", { a: { A: 1 }, A: 1, b: "B" }],
  ])("upstream inline merge: %s", (source, expected) => {
    expect(parseDocument(yaml11(source)).toJS()).toEqual(expected);
    compare(yaml11(source), [-1, 0, 1, 2, 100]);
  });

  test("upstream repeated merges retain explicit/first-source precedence", () => {
    const prefix =
      "sources:\n  - &a {k0: v1, k1: v1}\n  - &b {k1: v2, k2: v2}\nresult:\n  k0: v0\n";
    for (const suffix of ["  <<: *a\n  <<: *b", "  <<: [*a, *b]"]) {
      const source = yaml11(prefix + suffix);
      expect(parseDocument(source).toJS()).toEqual({
        sources: [
          { k0: "v1", k1: "v1" },
          { k1: "v2", k2: "v2" },
        ],
        result: { k0: "v0", k1: "v1", k2: "v2" },
      });
      compare(source, [-1, 0, 1, 2, 3, 100]);
    }
  });

  test("merge conversion observes owned source mutations without native node callbacks", () => {
    const document = parseDocument("{ !!merge <<: {first: one}, second: two }");
    if (!isMap(document.contents)) {
      throw new Error("Expected mapping");
    }
    const source = document.contents.items[0]?.value;
    if (!isMap(source)) {
      throw new Error("Expected inline source");
    }
    const value = source.get("first", true);
    if (!isScalar(value)) {
      throw new Error("Expected scalar");
    }
    value.value = "changed";
    expect(document.toJS()).toEqual({ first: "changed", second: "two" });
    expect(document.contents.toJSON()).toEqual({ first: "changed", second: "two" });
  });

  test.each([
    "{ <<: A, B: b }",
    "- &A a\n- { <<: *A, B: b }",
    "{ <<: [ [42] ], a: A }",
    "&A { <<: *A, B: b }",
    "- &items [{a: A}, {b: B}]\n- {<<: *items, c: C}",
    "- &A {__proto__: [42]}\n- {<<: *A}",
    "- &A {constructor: own, toString: own}\n- {<<: *A}",
    "{<<: {first: {nested: value}}, first: explicit}",
    "{first: explicit, <<: {first: merged, second: value}}",
    "{ '<<': literal, \"<<\": also-literal }",
    "- &src {first: &nested {value: 1}}\n- {<<: *src}\n- *nested\n- *src",
    "{<<: &a {self: *a}}",
    "{<<: !!set {ab, cd}}",
    "{<<: !!set {1, 2}}",
    "set: !!set {key: &anchor null}\ncopy: *anchor",
    "&a !!omap [{self: *a}]",
    "&a !!pairs [{self: *a}]",
    "&a !!set {*a}",
    "&a !!omap [{*a : 1}]",
    "!!omap [{&a first: 1}, {*a : 2}]",
    "!!set {[first, second]: null}",
    "!!omap [{[first, second]: value}]",
    "!!set {<<: null}",
  ])("merge/collection edge matches values, identity, node JSON and errors: %s", (source) => {
    // Keep cyclic merge checks bounded: unlimited recursion has runtime-specific
    // stack depth; the default alias cap is still checked, including exact error.
    compare(yaml11(source), [0, 1, 2, 3, 100]);
  });
});
