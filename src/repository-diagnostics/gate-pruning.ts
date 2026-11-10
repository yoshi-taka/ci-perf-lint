import type {
  GateKey,
  GateResultRecord,
  RepositoryDiagnosticGateState,
} from "./collector-types.ts";

export function pruneGateDescendants(
  successors: ReadonlyMap<GateKey, readonly GateKey[]>,
  key: GateKey,
  reason: GateKey,
  context: {
    state: RepositoryDiagnosticGateState;
    results: GateResultRecord;
    observability: { derivedFalse: { gate: string; dueTo: string[] }[] };
  },
): void {
  const { state, results, observability } = context;
  const visited = new Set<GateKey>();
  const stack = [...(successors.get(key) ?? [])];

  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (visited.has(curr)) {
      continue;
    }
    visited.add(curr);

    results[curr] = { status: "skipped", reason: `parent gate ${reason} is not resolved true` };
    const dueTo = state[curr] ? reason : key;
    state[curr] = false;
    const existing = observability.derivedFalse.find((d) => d.gate === curr);
    if (existing) {
      if (!existing.dueTo.includes(dueTo)) {
        existing.dueTo.push(dueTo);
      }
    } else {
      observability.derivedFalse.push({ gate: curr, dueTo: [dueTo] });
    }

    // A false/unobserved intermediate says nothing about its descendants' state.
    stack.push(...(successors.get(curr) ?? []));
  }
}
