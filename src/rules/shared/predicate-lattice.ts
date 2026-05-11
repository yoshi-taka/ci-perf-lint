export function buildReverseGraph(
  graph: ReadonlyMap<string, readonly string[] | ReadonlySet<string>>,
): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const [source, targets] of graph) {
    for (const target of targets) {
      const sources = reverse.get(target) ?? [];
      sources.push(source);
      reverse.set(target, sources);
    }
  }
  return reverse;
}

function normalizeGraph(graph: ReadonlyMap<string, ReadonlySet<string>>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const keys = [...graph.keys()].sort();
  for (const key of keys) {
    const values = [...(graph.get(key) ?? [])].sort();
    if (values.length > 0) {
      result.set(key, values);
    }
  }
  return result;
}

export function transitiveClosure(
  graph: ReadonlyMap<string, readonly string[]>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const allKeys = [...graph.keys()].sort();
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
