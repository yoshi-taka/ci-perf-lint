import { describe, expect, test } from "bun:test";
import type { GateKey, GateResultRecord } from "../src/repository-diagnostics/collector-types.ts";
import { pruneGateDescendants } from "../src/repository-diagnostics/gate-pruning.ts";
import { gateKeys } from "../src/repository-diagnostics/gates.ts";

const nodes = [
  gateKeys.javascriptTooling,
  gateKeys.javascriptLinting,
  gateKeys.javascriptBuildConfig,
  gateKeys.javascriptFrameworks,
] as const;
const allKeys = Object.values(gateKeys);

function initial(values: readonly boolean[]) {
  const state = Object.fromEntries(allKeys.map((key) => [key, false])) as Record<GateKey, boolean>;
  for (const [i, key] of nodes.entries()) {
    state[key] = values[i] ?? false;
  }
  const results = Object.fromEntries(
    allKeys.map((key) => [key, { status: "resolved", value: state[key] }]),
  ) as GateResultRecord;
  return { state, results };
}

describe("gate descendant pruning", () => {
  test("matches independent reachability on every four-node DAG and initial state", () => {
    const edges = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ] as const;
    let cases = 0;
    for (let mask = 0; mask < 64; mask++) {
      const graph = new Map<GateKey, GateKey[]>(nodes.map((key) => [key, []]));
      for (const [bit, [from, to]] of edges.entries()) {
        if (mask & (1 << bit)) {
          graph.get(nodes[from])!.push(nodes[to]);
        }
      }
      for (let bits = 0; bits < 16; bits++) {
        for (const root of nodes) {
          const before = nodes.map((_, i) => Boolean(bits & (1 << i)));
          const { state, results } = initial(before);
          // BFS oracle never consults gate truth values.
          const reached = new Set<GateKey>();
          const queue = [...graph.get(root)!];
          for (const key of queue) {
            if (reached.has(key)) {
              continue;
            }
            reached.add(key);
            queue.push(...graph.get(key)!);
          }
          const originalState = { ...state };
          const observability = { derivedFalse: [] as { gate: string; dueTo: string[] }[] };
          pruneGateDescendants(graph, root, root, { state, results, observability });
          for (const key of allKeys) {
            expect(state[key]).toBe(reached.has(key) ? false : originalState[key]);
            expect(results[key]).toEqual(
              reached.has(key)
                ? { status: "skipped", reason: `parent gate ${root} is not resolved true` }
                : { status: "resolved", value: originalState[key] },
            );
          }
          expect(new Set(observability.derivedFalse.map((entry) => entry.gate))).toEqual(reached);
          expect(observability.derivedFalse.length).toBe(reached.size);
          for (const entry of observability.derivedFalse) {
            expect(entry.dueTo).toEqual([root]);
          }
          cases++;
        }
      }
    }
    expect(cases).toBe(4096);
  });

  test("crosses a false intermediate, terminates cycles, and preserves existing reasons", () => {
    const [root, middle, leaf] = nodes;
    const graph = new Map<GateKey, GateKey[]>([
      [root, [middle]],
      [middle, [leaf, leaf]],
      [leaf, [middle]],
    ]);
    const { state, results } = initial([false, false, true]);
    const reason = gateKeys.rust;
    const observability: { derivedFalse: { gate: string; dueTo: string[] }[] } = {
      derivedFalse: [{ gate: middle, dueTo: [reason] }],
    };
    pruneGateDescendants(graph, root, reason, { state, results, observability });
    expect(state[middle]).toBe(false);
    expect(state[leaf]).toBe(false);
    expect(results[leaf]).toEqual({
      status: "skipped",
      reason: `parent gate ${reason} is not resolved true`,
    });
    expect(observability.derivedFalse).toEqual([
      { gate: middle, dueTo: [reason, root] },
      { gate: leaf, dueTo: [reason] },
    ]);
    pruneGateDescendants(graph, root, reason, { state, results, observability });
    expect(observability.derivedFalse).toEqual([
      { gate: middle, dueTo: [reason, root] },
      { gate: leaf, dueTo: [reason, root] },
    ]);
    pruneGateDescendants(graph, root, reason, { state, results, observability });
    expect(observability.derivedFalse).toHaveLength(2);
    expect(observability.derivedFalse[1]?.dueTo).toEqual([reason, root]);
  });
});
