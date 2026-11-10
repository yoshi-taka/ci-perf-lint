import { resolveMergeTag } from "./yaml-collection-resolve.ts";
import type { ParseDocumentResult, ParseNode, ParseScalarNode } from "./yaml-parse.ts";

function sameScalarKey(a: ParseScalarNode, b: ParseScalarNode): boolean {
  // Match both parser stages: source-signature checks and resolved-value checks.
  return (
    a.value === b.value ||
    (a.type === b.type && a.source === b.source && String(a.value) === String(b.value))
  );
}

/** Enable only merge-key resolution, without YAML 1.1 boolean/number coercions. */
export function enableMergeKeys(result: ParseDocumentResult): ParseDocumentResult {
  const reconsidered = new Set<number>();
  const duplicateOffsets = new Set<number>();
  const pending: (ParseNode | null)[] = [result.contents];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.kind === "map") {
      let hasMerge = false;
      for (const pair of node.items) {
        const key = pair.key;
        if (
          key?.kind === "scalar" &&
          (key.mergeKey || (key.type === "PLAIN" && key.source === "<<" && key.tag === undefined))
        ) {
          const merge = resolveMergeTag(key.source);
          key.value = merge.value;
          key.mergeKey = true;
          hasMerge = true;
        }
        pending.push(pair.key, pair.value);
      }
      if (hasMerge) {
        const seen: ParseScalarNode[] = [];
        for (const pair of node.items) {
          const key = pair.key;
          if (key?.kind !== "scalar") {
            continue;
          }
          reconsidered.add(key.range[0]);
          if (!key.mergeKey) {
            if (seen.some((previous) => sameScalarKey(previous, key))) {
              duplicateOffsets.add(key.range[0]);
            }
            seen.push(key);
          }
        }
      }
    } else if (node?.kind === "seq") {
      for (const item of node.items) {
        pending.push(item);
      }
    }
  }
  // Reclassify scalar duplicates only in maps with merge keys: quoted/!!str <<
  // remains an ordinary key, distinct from a merge directive, but two such literal
  // keys are still duplicates. All other parser diagnostics remain unchanged.
  return {
    ...result,
    errors: result.errors.filter(
      (error) =>
        error.code !== "DUPLICATE_KEY" ||
        !reconsidered.has(error.pos[0]) ||
        duplicateOffsets.has(error.pos[0]),
    ),
  };
}
