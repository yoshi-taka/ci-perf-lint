import { Alias, Pair, Scalar, YAMLMap, YAMLSeq, isNode, jsonKey, type Node } from "./yaml-ast.ts";
import { mergeEntries, type ConvertedMap } from "./yaml-merge.ts";
import { formatComplexKey, type KeyFormatting } from "./yaml-key-stringifier.ts";

interface AnchorValue {
  value: unknown;
  references: number;
  weight: number;
}

function children(value: unknown): unknown[] | undefined {
  if (value instanceof YAMLMap || value instanceof YAMLSeq) {
    return value.items;
  }
  if (value instanceof Pair) {
    return [value.key, value.value];
  }
  return undefined;
}

/** Resolve by AST order, not source offsets: redefined anchors and mutations matter. */
function indexAliases(root: unknown): Map<Alias, Node | undefined> {
  const targets = new Map<Alias, Node | undefined>();
  const names = new Map<string, Node>();
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (node instanceof Alias) {
      targets.set(node, names.get(node.source));
    } else if (isNode(node) && node.anchor) {
      names.set(node.anchor, node);
    }
    const items = children(node);
    if (items) {
      for (let index = items.length - 1; index >= 0; index--) {
        pending.push(items[index]);
      }
    }
  }
  return targets;
}

/**
 * Document conversion, including resolved special collections and merge keys.
 * Only exceptional key formatting may use the compatibility adapter.
 */
export function convertDocument(
  root: unknown,
  options: { maxAliasCount?: number; mapAsMap?: boolean } = {},
  json = false,
  arg: string | null = "",
  keyFormatting?: KeyFormatting,
): unknown {
  const anchors = new Map<Node, AnchorValue>();
  const limit = typeof options.maxAliasCount === "number" ? options.maxAliasCount : 100;
  let targets: Map<Alias, Node | undefined> | undefined;
  let mapKeyWarned = false;

  function stringKey(node: unknown, value: unknown): string {
    if (value === null || typeof value !== "object" || !isNode(node)) {
      return jsonKey(value);
    }
    const text = formatComplexKey(node, anchors.keys(), keyFormatting);
    if (!mapKeyWarned) {
      let shown = JSON.stringify(text);
      if (shown.length > 40) {
        shown = `${shown.substring(0, 36)}..."`;
      }
      const message = `Keys with collection values will be stringified due to JS Object restrictions: ${shown}. Set mapAsMap: true to use object keys.`;
      if (typeof process.emitWarning === "function") {
        process.emitWarning(message);
      } else {
        console.warn(message);
      }
      mapKeyWarned = true;
    }
    return text;
  }

  // Match the compatibility backend's amplification metric: maximum child weight,
  // multiplied by the target's current reference count. Never expand alias values.
  function aliasWeight(rootNode: Node): number {
    let maximum = 0;
    const pending: unknown[] = [rootNode];
    while (pending.length) {
      const node = pending.pop();
      if (node instanceof Alias) {
        const target = targets?.get(node);
        const data = target ? anchors.get(target) : undefined;
        if (data) {
          maximum = Math.max(maximum, data.references * data.weight);
        }
      } else {
        const items = children(node);
        if (items) {
          for (const item of items) {
            pending.push(item);
          }
        } else {
          maximum = Math.max(maximum, 1);
        }
      }
    }
    return maximum;
  }

  function resolveAlias(value: Alias): Node {
    if (limit === 0) {
      throw new ReferenceError("Alias resolution is disabled");
    }
    targets ??= indexAliases(root);
    const target = targets.get(value);
    if (!target) {
      throw new ReferenceError(
        `Unresolved alias (the anchor must be set before the alias): ${value.source}`,
      );
    }
    let data = anchors.get(target);
    // A set ignores its values, but an alias may target an anchor on one.
    // Inline merge sources also bypass the normal collection wrapper.
    if (!data) {
      convert(target, null);
      data = anchors.get(target);
    }
    if (data?.value === undefined) {
      throw new ReferenceError("This should not happen: Alias anchor was not resolved?");
    }
    if (limit >= 0) {
      data.references++;
      if (data.weight === 0) {
        data.weight = aliasWeight(target);
      }
      if (data.references * data.weight > limit) {
        throw new ReferenceError("Excessive alias count indicates a resource exhaustion attack");
      }
    }
    return target;
  }

  function mergeValue(record: ConvertedMap, value: unknown): void {
    const source = value instanceof Alias ? resolveAlias(value) : value;
    if (!(source instanceof YAMLMap)) {
      throw new Error("Merge sources must be maps or map aliases");
    }
    // Deliberately rebuild the source map: the backend does not merge its cached
    // object. Only this level is forced to Map; child collections use options.
    const entries = mappingValue(source, true);
    mergeEntries(record, entries as Map<unknown, unknown> | Set<unknown>);
  }

  function addPair(record: ConvertedMap, pair: Pair): void {
    if (pair.key instanceof Scalar && pair.key.mergeKey) {
      const source = pair.value instanceof Alias ? resolveAlias(pair.value) : pair.value;
      const sources =
        source instanceof YAMLSeq ? source.items : Array.isArray(source) ? source : [source];
      for (const item of sources) {
        mergeValue(record, item);
      }
      return;
    }
    const convertedKey = convert(pair.key, "");
    if (record instanceof Set) {
      record.add(convertedKey);
    } else if (record instanceof Map) {
      record.set(convertedKey, convert(pair.value, convertedKey));
    } else {
      const key = stringKey(pair.key, convertedKey);
      Object.defineProperty(record, key, {
        value: convert(pair.value, key),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  function mappingValue(value: YAMLMap | Pair, forceMap = false, data?: AnchorValue): ConvertedMap {
    const record: ConvertedMap =
      value instanceof YAMLMap && value.collectionType === "set"
        ? new Set()
        : forceMap || options.mapAsMap === true
          ? new Map()
          : {};
    if (data) {
      data.value = record;
    }
    for (const pair of value instanceof Pair ? [value] : value.items) {
      addPair(record, pair);
    }
    return record;
  }

  function orderedValue(value: YAMLSeq, data?: AnchorValue): Map<unknown, unknown> {
    const map = new Map<unknown, unknown>();
    if (data) {
      data.value = map;
    }
    for (const pair of value.items) {
      const key = convert(pair instanceof Pair ? pair.key : pair, "");
      const item = pair instanceof Pair ? convert(pair.value, key) : undefined;
      if (map.has(key)) {
        throw new Error("Ordered maps must not include duplicate keys");
      }
      map.set(key, item);
    }
    return map;
  }

  function convert(value: unknown, key: unknown): unknown {
    if (value instanceof Alias) {
      const target = resolveAlias(value);
      return anchors.get(target)!.value;
    }

    // Register an empty collection before its children so self-references work.
    const data: AnchorValue | undefined =
      isNode(value) && value.anchor ? { value: undefined, references: 1, weight: 0 } : undefined;
    if (data && isNode(value)) {
      anchors.set(value, data);
    }
    let result: unknown;
    if (value instanceof YAMLMap || value instanceof Pair) {
      result = mappingValue(value, false, data);
    } else if (value instanceof YAMLSeq && value.collectionType === "omap") {
      result = orderedValue(value, data);
    } else if (value instanceof YAMLSeq) {
      const sequence: unknown[] = [];
      result = sequence;
      if (data) {
        data.value = sequence;
      }
      for (const item of value.items) {
        sequence.push(convert(item, String(sequence.length)));
      }
    } else if (value instanceof Scalar) {
      result = json ? value.toJSON(key) : value.value;
    } else {
      result = typeof value === "bigint" && json ? Number(value) : value;
    }
    if (data) {
      data.value = result;
    }
    return result;
  }

  return convert(root, arg ?? "");
}
