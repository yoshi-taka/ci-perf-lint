export interface CollectionNode {
  items: unknown[];
  comment?: string | null;
  commentBefore?: string | null;
  spaceBefore?: boolean;
  range?: readonly number[] | null;
  tag?: string;
  anchor?: string;
  collectionType?: "set" | "omap";
}

export interface CollectionPair {
  key: unknown;
  value: unknown;
}

export interface CollectionScalar {
  value: unknown;
  comment?: string | null;
  commentBefore?: string | null;
  spaceBefore?: boolean;
  tag?: string;
}

export interface CollectionTagApi {
  isMap(value: unknown): value is CollectionNode;
  isSeq(value: unknown): value is CollectionNode;
  isPair(value: unknown): value is CollectionPair;
  isScalar(value: unknown): value is CollectionScalar;
  pair(key: unknown, value: unknown): CollectionPair;
  scalar(value: unknown): CollectionScalar;
}

interface Annotations {
  comment?: string | null;
  commentBefore?: string | null;
  spaceBefore?: boolean;
}

function annotations(value: unknown): Annotations | undefined {
  return value !== null && typeof value === "object" ? value : undefined;
}

function prependComment(node: Annotations, field: "comment" | "commentBefore", text: string): void {
  node[field] = node[field] ? `${text}\n${node[field]}` : text;
}

function normalizePair(
  entry: unknown,
  api: CollectionTagApi,
  onError: (message: string) => void,
): CollectionPair {
  if (api.isPair(entry)) {
    return entry;
  }
  if (!api.isMap(entry)) {
    return api.pair(entry, null);
  }
  if (entry.items.length > 1) {
    onError("Each pair must have its own sequence indicator");
  }
  const pair =
    entry.items.length === 0
      ? api.pair(api.scalar(null), null)
      : (entry.items[0] as CollectionPair);
  const key = annotations(pair.key);
  if (key) {
    if (entry.commentBefore) {
      prependComment(key, "commentBefore", entry.commentBefore);
    }
  }
  if (entry.comment) {
    const target = annotations(pair.value) ?? key;
    if (target) {
      prependComment(target, "comment", entry.comment);
    }
  }
  return pair;
}

export function resolveCollectionTag(
  tag: string,
  node: CollectionNode,
  api: CollectionTagApi,
  onError: (message: string) => void,
): { node: CollectionNode; collectionType?: "set" | "omap" } {
  if (tag === "tag:yaml.org,2002:set") {
    const valid = node.items.every((item) => {
      if (!api.isPair(item)) {
        return false;
      }
      const value = item.value;
      return (
        value === null ||
        (api.isScalar(value) &&
          value.value === null &&
          !value.tag &&
          !value.comment &&
          !value.commentBefore)
      );
    });
    if (!valid) {
      onError("Set items must all have null values");
    }
    return { node, collectionType: "set" };
  }
  if (tag !== "tag:yaml.org,2002:pairs" && tag !== "tag:yaml.org,2002:omap") {
    return { node };
  }
  for (let index = 0; index < node.items.length; index += 1) {
    node.items[index] = normalizePair(node.items[index], api, onError);
  }
  if (tag === "tag:yaml.org,2002:omap") {
    const keys = new Set<unknown>();
    for (const item of node.items) {
      if (api.isPair(item) && api.isScalar(item.key)) {
        const key = item.key.value;
        if (keys.has(key)) {
          onError(`Ordered maps must not include duplicate keys: ${String(key)}`);
        } else {
          keys.add(key);
        }
      }
    }
    return { node, collectionType: "omap" };
  }
  return { node };
}

export function resolveMergeTag(_source: string): { value: symbol; mergeKey: true } {
  return { value: Symbol("<<"), mergeKey: true };
}
