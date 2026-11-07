import { describe, expect, test } from "bun:test";
import * as reference from "yaml";
import { parseDocument, isMap, isNode, isScalar, isSeq } from "../src/yaml.ts";
import { Alias, Pair, Scalar, YAMLMap, YAMLSeq } from "../src/yaml-ast.ts";

describe("repository-owned YAML AST", () => {
  test("ordinary parsed nodes and pairs have no external AST identity", () => {
    const document = parseDocument(
      "base: &base {value: 1}\ncopy: *base\nsteps: [one, {run: two}]\n",
    );
    const pending: unknown[] = [document.contents];
    let count = 0;
    while (pending.length) {
      const node = pending.pop();
      if (node === null) {
        continue;
      }
      expect(reference.isNode(node)).toBe(false);
      expect(reference.isPair(node)).toBe(false);
      if (isMap(node)) {
        pending.push(...node.items);
      } else if (isSeq(node)) {
        pending.push(...node.items);
      } else if (node instanceof Pair) {
        pending.push(node.key, node.value);
      } else {
        expect(isNode(node)).toBe(true);
      }
      count++;
    }
    expect(count).toBeGreaterThan(10);
  });

  test("scalar/map/sequence conversion operates on owned nodes rather than cached backend values", () => {
    const document = parseDocument("value: original\nlist: [one, two]\n");
    if (!isMap(document.contents)) {
      throw new Error("Expected map");
    }
    const scalar = document.contents.items[0]?.value;
    const sequence = document.contents.items[1]?.value;
    if (!isScalar(scalar) || !isSeq(sequence)) {
      throw new Error("Expected scalar and sequence");
    }
    scalar.value = "changed";
    const mutableSequence: YAMLSeq = sequence;
    mutableSequence.items.push(new Scalar("three"));
    expect(document.contents.toJSON()).toEqual({ value: "changed", list: ["one", "two", "three"] });
  });

  test("synthetic ASTs serialize without any parser backend", () => {
    const map = new YAMLMap();
    const sequence = new YAMLSeq();
    sequence.items.push(new Scalar(1), new Alias("reference"));
    map.items.push(new Pair(new Scalar("list"), sequence));
    expect(map.toJSON()).toEqual({ list: [1, { source: "reference" }] });
    expect(isNode(new Pair(null, null))).toBe(false);
    expect(isMap({ kind: "map", items: [] })).toBe(false);
  });

  test("document and map get() preserve scalar unwrapping and false values", () => {
    const document = parseDocument(
      "storeDir: /cache\nenableGlobalVirtualStore: false\nenv: {RUSTFLAGS: '-Z threads=8'}\n",
    );
    expect(document.get("storeDir")).toBe("/cache");
    expect(document.get("enableGlobalVirtualStore")).toBe(false);
    expect(document.get("missing")).toBeUndefined();
    expect(isScalar(document.get("storeDir", true))).toBe(true);
    const environment = document.get("env");
    if (!isMap(environment)) {
      throw new Error("Expected environment mapping");
    }
    expect(environment.get("RUSTFLAGS")).toBe("-Z threads=8");
    expect(isScalar(environment.get("RUSTFLAGS", true))).toBe(true);
    expect(parseDocument("[first, false]").get(1)).toBe(false);
    expect(isScalar(parseDocument("[first]").get("0", true))).toBe(true);
    expect(parseDocument("scalar").get("missing")).toBeUndefined();
  });

  test("version annotation comments and block-scalar styles remain available to rules", () => {
    const document = parseDocument(
      "uses: actions/cache@0000000000000000000000000000000000000000 # ratchet:actions/cache@v4.2.0\nrun: |-\n  pytest -n auto\nfolded: >\n  echo done\n",
    );
    const uses = document.get("uses", true);
    const run = document.get("run", true);
    const folded = document.get("folded", true);
    if (!isScalar(uses) || !isScalar(run) || !isScalar(folded)) {
      throw new Error("Expected scalars");
    }
    expect(uses.comment?.trim()).toBe("ratchet:actions/cache@v4.2.0");
    expect(run.type).toBe("BLOCK_LITERAL");
    expect(folded.type).toBe("BLOCK_FOLDED");
    expect(run.source).toBe("pytest -n auto");
  });

  test("JSON conversion retains null/complex keys, duplicate assignment and own prototype keys", () => {
    const map = new YAMLMap();
    map.items.push(
      new Pair(new Scalar(null), new Scalar("empty key")),
      new Pair(new Scalar("__proto__"), new Scalar("data")),
      new Pair(new Scalar("constructor"), new Scalar("constructor data")),
      new Pair(new Scalar("duplicate"), new Scalar("first")),
      new Pair(new Scalar("duplicate"), new Scalar("last")),
    );
    const result = map.toJSON();
    expect(result).toEqual(
      JSON.parse(
        '{"":"empty key","__proto__":"data","constructor":"constructor data","duplicate":"last"}',
      ),
    );
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    const complex = parseDocument("? [first, second]\n: value\n");
    expect(complex.contents?.toJSON()).toEqual(
      reference.parseDocument("? [first, second]\n: value\n").contents?.toJSON(),
    );
  });

  test.each([
    "date: !!timestamp 2026-11-06\n",
    "bytes: !!binary aGVsbG8=\n",
    "set: !!set {first: null, second: null}\n",
    "ordered: !!omap [{first: one}, {second: two}]\n",
    "pairs: !!pairs [{first: one}, {first: two}]\n",
    "%YAML 1.1\n---\nbase: &base {x: 1}\ncopy: {<<: *base, y: 2}\n",
  ])("special schema behavior is retained during the backend bridge: %s", (source) => {
    const expected = reference.parseDocument(source);
    const actual = parseDocument(source);
    expect(actual.errors.map((error) => error.code)).toEqual(
      expected.errors.map((error) => error.code),
    );
    expect(actual.toJS()).toEqual(expected.toJS());
    let referenceError: unknown;
    let referenceValue: unknown;
    try {
      referenceValue = expected.contents?.toJSON();
    } catch (error) {
      referenceError = error;
    }
    if (referenceError) {
      if (!(referenceError instanceof Error)) {
        throw referenceError;
      }
      expect(() => actual.contents?.toJSON()).toThrow(referenceError.message);
    } else {
      expect(actual.contents?.toJSON()).toEqual(referenceValue);
    }
  });
});
