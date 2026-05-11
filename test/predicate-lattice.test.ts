import { describe, expect, test } from "bun:test";
import { transitiveClosure, buildReverseGraph } from "../src/rules/shared/predicate-lattice.ts";

describe("transitiveClosure", () => {
  test("empty graph returns empty map", () => {
    const result = transitiveClosure(new Map());
    expect(result.size).toBe(0);
  });

  test("single node with no edges returns empty map", () => {
    const graph = new Map([["a", []]]);
    const result = transitiveClosure(graph);
    expect(result.size).toBe(0);
  });

  test("direct edge produces one closure", () => {
    const graph = new Map([["a", ["b"]]]);
    const result = transitiveClosure(graph);
    expect([...result.get("a")!]).toEqual(["b"]);
  });

  test("chain A->B->C produces A->B, A->C, B->C", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
    ]);
    const result = transitiveClosure(graph);
    expect([...result.get("a")!.values()].sort()).toEqual(["b", "c"]);
    expect([...result.get("b")!.values()]).toEqual(["c"]);
  });

  test("diamond: A->B, A->C, B->D, C->D", () => {
    const graph = new Map([
      ["a", ["b", "c"]],
      ["b", ["d"]],
      ["c", ["d"]],
    ]);
    const result = transitiveClosure(graph);
    expect([...result.get("a")!.values()].sort()).toEqual(["b", "c", "d"]);
    expect([...result.get("b")!.values()]).toEqual(["d"]);
    expect([...result.get("c")!.values()]).toEqual(["d"]);
  });

  test("cycle does not cause infinite loop", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["a"]],
    ]);
    const result = transitiveClosure(graph);
    expect(result.get("a")!.has("b")).toBe(true);
    expect(result.get("a")!.has("c")).toBe(true);
    expect(result.get("b")!.has("a")).toBe(true);
    expect(result.get("b")!.has("c")).toBe(true);
    expect(result.get("c")!.has("a")).toBe(true);
    expect(result.get("c")!.has("b")).toBe(true);
  });

  test("self-loop does not add self to closure", () => {
    const graph = new Map([["a", ["a"]]]);
    const result = transitiveClosure(graph);
    expect(result.has("a")).toBe(false);
  });

  test("node with no outbound edges but referenced by others", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", []],
    ]);
    const result = transitiveClosure(graph);
    expect(result.has("b")).toBe(false);
  });

  test("deterministic ordering across same graph", () => {
    const graph = new Map([
      ["z", ["a"]],
      ["y", ["b"]],
      ["x", ["c"]],
    ]);
    const a = transitiveClosure(graph);
    const b = transitiveClosure(graph);
    expect([...a.keys()]).toEqual([...b.keys()]);
  });
});

describe("buildReverseGraph", () => {
  test("builds reverse mapping", () => {
    const forward = new Map([
      ["a", ["b", "c"]],
      ["b", ["c"]],
    ]);
    const reverse = buildReverseGraph(forward);
    expect(reverse.get("b")).toEqual(["a"]);
    const cSources = reverse.get("c");
    expect(cSources).toBeDefined();
    expect(cSources!.sort()).toEqual(["a", "b"]);
  });

  test("empty for orphan nodes", () => {
    const forward = new Map([["a", []]]);
    const reverse = buildReverseGraph(forward);
    expect(reverse.size).toBe(0);
  });
});
