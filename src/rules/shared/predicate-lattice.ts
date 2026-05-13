export function buildReverseGraph<T extends string>(
  graph: ReadonlyMap<T, readonly T[] | ReadonlySet<T>>,
): Map<T, T[]> {
  const reverse = new Map<T, T[]>();
  for (const [source, targets] of graph) {
    for (const target of targets) {
      const sources = reverse.get(target) ?? [];
      sources.push(source);
      reverse.set(target, sources);
    }
  }
  return reverse;
}

export function transitiveClosure<T extends string>(
  graph: ReadonlyMap<T, readonly T[]>,
): Map<T, Set<T>> {
  const result = new Map<T, Set<T>>();
  const allKeys = [...graph.keys()].sort();
  for (const node of allKeys) {
    const visited = new Set<T>([node]);
    const stack = [...(graph.get(node) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const next = graph.get(current) ?? [];
      for (const n of next) {
        if (!visited.has(n)) {
          stack.push(n);
        }
      }
    }
    visited.delete(node);
    if (visited.size > 0) {
      result.set(node, visited);
    }
  }
  return result;
}
