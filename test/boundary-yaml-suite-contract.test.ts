import { describe, expect, test } from "bun:test";
import { parseDocument } from "../src/yaml.ts";

// Independently minimized/adapted cases from the language's test suite, not a
// copied parser. IDs link each case back to its original grammar regression.
// https://github.com/yaml/yaml-test-suite/tree/6ad3d2c62885d82fc349026c136ef560838fdf3d
describe("YAML test-suite compatibility seeds", () => {
  test("229Q: sequence of mappings", () => {
    expect(
      parseDocument(
        "-\n  name: first\n  count: 7\n  ratio: 0.5\n-\n  name: second\n  count: 3\n",
      ).toJS(),
    ).toEqual([
      { name: "first", count: 7, ratio: 0.5 },
      { name: "second", count: 3 },
    ]);
  });

  test("26DV: mapping whitespace and aliases used as keys", () => {
    const document = parseDocument('"first" :\n  "key" : &key scalar\nsecond:\n  *key : value\n');
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toEqual({ first: { key: "scalar" }, second: { scalar: "value" } });
  });

  test("27NA: directive and scalar on the document start line", () => {
    expect(parseDocument("%YAML 1.2\n--- payload\n").toJS()).toBe("payload");
  });

  test("2AUY / 33X3: explicit tags in block sequences", () => {
    expect(parseDocument("- !!str true\n- plain\n- !!int 42\n- !!int -7\n").toJS()).toEqual([
      "true",
      "plain",
      42,
      -7,
    ]);
  });

  test("2EBW: indicator-looking keys and embedded hashes are not comments", () => {
    expect(
      parseDocument("?key: question\n:key: colon\n-key: dash\nthis is#not: a comment\n").toJS(),
    ).toEqual({ "?key": "question", ":key": "colon", "-key": "dash", "this is#not": "a comment" });
  });

  test("36F6: blank lines in multiline plain scalars", () => {
    expect(parseDocument("message: first\n second\n\n third\n").toJS()).toEqual({
      message: "first second\nthird",
    });
  });

  test("3ALJ: block sequence nested in a block sequence", () => {
    expect(parseDocument("- - first\n  - second\n- third\n").toJS()).toEqual([
      ["first", "second"],
      "third",
    ]);
  });

  test("3GZX: anchor reuse resolves to the latest preceding declaration", () => {
    expect(
      parseDocument("first: &name one\nsecond: *name\noverride: &name two\nreuse: *name\n").toJS(),
    ).toEqual({ first: "one", second: "one", override: "two", reuse: "two" });
  });

  test.each([
    ["236B", "key:\n  text\ninvalid\n"],
    ["2CMS", "this\n is\n  invalid: value\n"],
    ["2JQS", ": first\n: second\n"],
    ["3HFZ", "---\nkey: value\n... invalid\n"],
  ])("%s: invalid syntax remains a parse error", (_, source) => {
    expect(parseDocument(source).errors.length).toBeGreaterThan(0);
  });
});
