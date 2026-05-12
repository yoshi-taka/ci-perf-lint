export function topologicalSort<T extends string>(
  allNodes: Set<T>,
  successors: Map<T, readonly T[]>,
): readonly T[] {
  const inDegree = new Map<T, number>();
  for (const node of allNodes) {
    inDegree.set(node, 0);
  }
  for (const [, succs] of successors) {
    for (const succ of succs) {
      inDegree.set(succ, (inDegree.get(succ) ?? 0) + 1);
    }
  }

  const queue: T[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  const sorted: T[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    const succs = successors.get(node) ?? [];
    for (const succ of succs) {
      const newDegree = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDegree);
      if (newDegree === 0) {
        queue.push(succ);
      }
    }
  }

  return sorted;
}
