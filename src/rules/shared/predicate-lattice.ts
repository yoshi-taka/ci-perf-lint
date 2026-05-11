export function transitiveClosure(
  graph: ReadonlyMap<string, readonly string[]>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const allKeys = [...graph.keys()];
  for (const node of allKeys) {
    const visited = new Set<string>([node]);
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
