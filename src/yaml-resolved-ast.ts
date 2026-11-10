import { Alias, Pair, Scalar, YAMLMap, YAMLSeq, isNode, type ParsedNode } from "./yaml-ast.ts";
import { indexAliases } from "./yaml-document.ts";

const MAX_DEPTH = 256;
const MAX_EXPANDED_NODES = 200_000;
const MAX_REFERENCE_WORK = 1_000_000;

export class YamlReferenceError extends Error {
  readonly offset: number;
  constructor(message: string, node: unknown) {
    super(message);
    this.offset = isNode(node) ? (node.range?.[0] ?? 0) : 0;
  }
}

interface Resolved {
  value: unknown;
  weight: number;
  height: number;
}

/** CI-facing, acyclic AST view. Leaves keep anchor-definition source ranges.
 * Collections are memoized/shared, but their logical expanded size is bounded.
 * Never mutate the syntax AST or re-serialize YAML (which would lose positions).
 */
export function resolveYamlAst(root: ParsedNode, options: { merge: boolean }): ParsedNode {
  const targets = indexAliases(root);
  const memo = new Map<object, Resolved>();
  const active = new Set<object>();
  const pairSizes = new Map<Pair, Resolved>();
  let work = 0;

  function tick(node: unknown): void {
    if (++work > MAX_REFERENCE_WORK) {
      throw new YamlReferenceError("YAML alias/merge resolution work limit exceeded", node);
    }
  }

  function bounded(value: unknown, weight: number, source: unknown, height: number): Resolved {
    if (weight > MAX_EXPANDED_NODES) {
      throw new YamlReferenceError("YAML alias expansion limit exceeded", source);
    }
    if (height > MAX_DEPTH) {
      throw new YamlReferenceError("YAML alias/merge nesting limit exceeded", source);
    }
    return { value, weight, height };
  }

  function mergeInto(target: Map<unknown, Pair>, value: unknown, source: unknown): void {
    const maps = value instanceof YAMLSeq ? value.items : [value];
    for (const map of maps) {
      if (!(map instanceof YAMLMap)) {
        throw new YamlReferenceError("Merge sources must be maps or map aliases", source);
      }
      for (const pair of map.items) {
        tick(source);
        const key = pair.key instanceof Scalar ? pair.key.value : pair.key;
        // Earlier merge sources win; explicit keys overwrite via Map.set below.
        if (!target.has(key)) {
          target.set(key, pair);
        }
      }
    }
  }

  function resolve(value: unknown, depth: number): Resolved {
    tick(value);
    if (depth > MAX_DEPTH) {
      throw new YamlReferenceError("YAML alias/merge nesting limit exceeded", value);
    }
    if (value instanceof Alias) {
      const target = targets.get(value);
      if (!target) {
        throw new YamlReferenceError(
          `Unresolved alias (anchor must precede alias): ${value.source}`,
          value,
        );
      }
      if (active.has(target)) {
        throw new YamlReferenceError("Cyclic YAML alias or merge", value);
      }
      return resolve(target, depth + 1);
    }
    if (!isNode(value) && !(value instanceof Pair)) {
      return { value, weight: 1, height: 0 };
    }
    const cached = memo.get(value);
    if (cached) {
      if (depth + cached.height > MAX_DEPTH) {
        throw new YamlReferenceError("YAML alias/merge nesting limit exceeded", value);
      }
      return cached;
    }
    if (active.has(value)) {
      throw new YamlReferenceError("Cyclic YAML alias or merge", value);
    }
    active.add(value);
    try {
      let result: Resolved;
      if (value instanceof Pair) {
        const key = resolve(value.key, depth + 1);
        const item = resolve(value.value, depth + 1);
        // An alias used as a key is data, not a newly spelled merge directive.
        const resolvedKey =
          value.key instanceof Alias && key.value instanceof Scalar
            ? Object.assign(new Scalar(key.value.value), key.value, { mergeKey: false })
            : key.value;
        const pair = new Pair(resolvedKey, item.value);
        result = bounded(
          pair,
          1 + key.weight + item.weight,
          value.key,
          1 + Math.max(key.height, item.height),
        );
        pairSizes.set(pair, result);
      } else if (value instanceof YAMLMap) {
        const pairs = new Map<unknown, Pair>();
        for (const pair of value.items) {
          const key = resolve(pair.key, depth + 1).value;
          const syntaxKey = pair.key;
          const isMerge =
            syntaxKey instanceof Scalar &&
            (syntaxKey.mergeKey === true ||
              (syntaxKey.mergeKey !== false &&
                syntaxKey.type === "PLAIN" &&
                syntaxKey.source === "<<" &&
                syntaxKey.tag === undefined));
          if (isMerge) {
            if (!options.merge) {
              throw new YamlReferenceError(
                "YAML merge keys are not supported by this CI platform",
                pair.key,
              );
            }
            mergeInto(pairs, resolve(pair.value, depth + 1).value, pair.value);
          } else {
            const resolved = resolve(pair, depth + 1).value as Pair;
            pairs.set(key instanceof Scalar ? key.value : key, resolved);
          }
        }
        let weight = 1;
        let height = 1;
        for (const pair of pairs.values()) {
          const size = pairSizes.get(pair)!;
          weight += size.weight;
          height = Math.max(height, 1 + size.height);
        }
        result = bounded(
          Object.assign(new YAMLMap(), value, { items: [...pairs.values()] }),
          weight,
          value,
          height,
        );
      } else if (value instanceof YAMLSeq) {
        const items: unknown[] = [];
        let weight = 1;
        let height = 1;
        for (const item of value.items) {
          const resolved = resolve(item, depth + 1);
          items.push(resolved.value);
          weight += resolved.weight;
          height = Math.max(height, 1 + resolved.height);
          bounded(value, weight, value, height);
        }
        result = bounded(Object.assign(new YAMLSeq(), value, { items }), weight, value, height);
      } else {
        result = { value, weight: 1, height: 0 };
      }
      memo.set(value, result);
      return result;
    } finally {
      active.delete(value);
    }
  }

  return resolve(root, 0).value as ParsedNode;
}
