import { describe, expect, test } from "bun:test";
import { parseDocument, isMap, isNode, type Node } from "yaml";
import { lazyNodeRecord, lazyOptionalNodeRecord, nodeToRecord } from "../src/lazy-node-record.ts";

function parseYaml(source: string) {
  return parseDocument(source);
}

describe("lazyNodeRecord", () => {
  test("returns a function", () => {
    const doc = parseYaml("foo: bar");
    const node = isMap(doc.contents) ? doc.contents : undefined;
    const getter = lazyNodeRecord(node);
    expect(typeof getter).toBe("function");
  });

  test("memoizes the result across multiple calls", () => {
    const doc = parseYaml("foo: bar");
    const node = isMap(doc.contents) ? doc.contents : undefined;
    const getter = lazyNodeRecord(node);
    const first = getter();
    const second = getter();
    expect(second).toBe(first);
  });

  test("returns empty object when node is undefined", () => {
    const getter = lazyNodeRecord(undefined);
    expect(getter()).toEqual({});
  });

  test("converts YAML map to record", () => {
    const doc = parseYaml("foo: bar");
    const node = isMap(doc.contents) ? doc.contents : undefined;
    expect(lazyNodeRecord(node)()).toEqual({ foo: "bar" });
  });

  test("same reference returned on multiple calls", () => {
    const doc = parseYaml("foo: bar");
    const node = isMap(doc.contents) ? doc.contents : undefined;
    const getter = lazyNodeRecord(node);
    const first = getter();
    const second = getter();
    const third = getter();
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});

describe("lazyOptionalNodeRecord", () => {
  test("returns a function", () => {
    const doc = parseYaml("foo: bar");
    const node = isMap(doc.contents) ? doc.contents : undefined;
    const getter = lazyOptionalNodeRecord(node);
    expect(typeof getter).toBe("function");
  });

  test("memoizes the result across multiple calls", () => {
    const doc = parseYaml("foo: bar");
    const node = isMap(doc.contents) ? doc.contents : undefined;
    const getter = lazyOptionalNodeRecord(node);
    const first = getter();
    const second = getter();
    expect(second).toBe(first);
  });

  test("returns undefined when node is undefined", () => {
    const getter = lazyOptionalNodeRecord(undefined);
    expect(getter()).toBeUndefined();
  });

  test("converts YAML map to record", () => {
    const doc = parseYaml("foo: bar");
    const node = isMap(doc.contents) ? doc.contents : undefined;
    expect(lazyOptionalNodeRecord(node)()).toEqual({ foo: "bar" });
  });

  test("same reference returned on multiple calls", () => {
    const doc = parseYaml("foo: bar");
    const node = isMap(doc.contents) ? doc.contents : undefined;
    const getter = lazyOptionalNodeRecord(node);
    const first = getter();
    const second = getter();
    const third = getter();
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});

describe("nodeToRecord", () => {
  test("returns undefined when node is undefined", () => {
    expect(nodeToRecord(undefined)).toBeUndefined();
  });

  test("converts YAML map node to record", () => {
    const doc = parseYaml("foo: bar\nbaz: qux");
    const node = isMap(doc.contents) ? doc.contents : undefined;
    expect(nodeToRecord(node)).toEqual({ foo: "bar", baz: "qux" });
  });

  test("returns undefined for non-object toJSON values", () => {
    const doc = parseYaml("foo");
    const node: Node | undefined = isNode(doc.contents) ? doc.contents : undefined;
    expect(nodeToRecord(node)).toBeUndefined();
  });
});
