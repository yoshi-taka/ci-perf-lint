import { mergeEntries, type ConvertedMap } from "./yaml-merge.ts";

/** Repository-owned AST surface consumed by CI rules and repository collectors. */
export type Range = [number, number, number];

type Kind = "scalar" | "alias" | "map" | "seq";
abstract class AstNode<K extends Kind = Kind> {
  constructor(public readonly kind: K) {}
  range?: Range | null;
  tag?: string;
  anchor?: string;
  comment?: string | null;
  commentBefore?: string | null;
  spaceBefore?: boolean;
  abstract toJSON(arg?: unknown): unknown;
}

export class Scalar<T = unknown> extends AstNode<"scalar"> {
  type?: string;
  source?: string;
  mergeKey?: boolean;
  format?: string;
  minFractionDigits?: number;
  constructor(public value: T) {
    super("scalar");
  }
  toJSON(arg?: unknown): unknown {
    return jsonValue(this.value, arg);
  }
}

export class Alias extends AstNode<"alias"> {
  constructor(public source: string) {
    super("alias");
  }
  // Runtime JSON dispatch: jsonValue(Alias) below preserves node-only alias semantics.
  toJSON(): { source: string } {
    return { source: this.source };
  }
}

export class Pair<K = unknown, V = unknown> {
  constructor(
    public key: K,
    public value: V,
  ) {}
  toJSON(): unknown {
    const record: Record<string, unknown> = {};
    addPair(record, this);
    return record;
  }
}

export class YAMLMap<K = unknown, V = unknown> extends AstNode<"map"> {
  items: Pair<K, V>[] = [];
  collectionType?: "set";
  constructor() {
    super("map");
  }
  // Used through ParsedDocument.get() and rule-side lookups such as step.node.get().
  get(key: unknown, keepScalar = false): unknown {
    const pair = findPair(this.items, key);
    if (this.collectionType === "set") {
      return keepScalar ? pair : pair?.key instanceof Scalar ? pair.key.value : pair?.key;
    }
    const value = pair?.value;
    return !keepScalar && value instanceof Scalar ? value.value : value;
  }
  // Used through Node unions in lazyNodeRecord and by jsonValue(YAMLMap) below.
  toJSON(): unknown {
    return nodeMapValue(this);
  }
}

export class YAMLSeq<T = unknown> extends AstNode<"seq"> {
  items: T[] = [];
  collectionType?: "omap";
  constructor() {
    super("seq");
  }
  // ParsedDocument.get() dispatches sequence-root lookups to this method.
  get(key: unknown, keepScalar = false): unknown {
    if (this.collectionType === "omap") {
      const value = findPair(this.items, key)?.value;
      return (!keepScalar && value instanceof Scalar ? value.value : value) ?? undefined;
    }
    const target = key instanceof Scalar ? key.value : key;
    const index =
      typeof target === "number" ? target : typeof target === "string" ? Number(target) : NaN;
    if (!Number.isInteger(index) || index < 0) {
      return undefined;
    }
    const value = this.items[index];
    return !keepScalar && value instanceof Scalar ? value.value : value;
  }
  // Workflow helpers and jsonValue(YAMLSeq) invoke this through the Node union.
  toJSON(): unknown[] {
    return this.items.map((item, index) => jsonValue(item, String(index)));
  }
}

function jsonValue(value: unknown, arg?: unknown): unknown {
  if (value instanceof Scalar) {
    return value.toJSON(arg);
  }
  if (value instanceof Alias) {
    return value.toJSON();
  }
  if (value instanceof Pair) {
    return value.toJSON();
  }
  if (value instanceof YAMLMap) {
    return value.toJSON();
  }
  if (value instanceof YAMLSeq) {
    return value.toJSON();
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => jsonValue(item, String(index)));
  }
  if (
    value &&
    typeof value === "object" &&
    "toJSON" in value &&
    typeof value.toJSON === "function"
  ) {
    return (value.toJSON as (arg?: unknown) => unknown).call(value, arg);
  }
  return typeof value === "bigint" ? Number(value) : value;
}

export function jsonKey(value: unknown): string {
  if (value === null) {
    return "";
  }
  switch (typeof value) {
    case "string":
      return value;
    case "undefined":
      return "undefined";
    case "boolean":
      return value ? "true" : "false";
    case "number":
    case "bigint":
    case "symbol":
      return value.toString();
    case "object":
      return JSON.stringify(value);
    case "function":
      return Function.prototype.toString.call(value);
    default:
      throw new TypeError("Unsupported YAML key type");
  }
}

function findPair(items: Iterable<unknown>, key: unknown): Pair | undefined {
  const target = key instanceof Scalar ? key.value : key;
  for (const item of items) {
    if (
      item instanceof Pair &&
      (item.key === key ||
        item.key === target ||
        (item.key instanceof Scalar && item.key.value === target))
    ) {
      return item;
    }
  }
  return undefined;
}

function nodeMapValue(node: YAMLMap, forceMap = false): ConvertedMap {
  const record: ConvertedMap =
    node.collectionType === "set" ? new Set() : forceMap ? new Map() : {};
  for (const pair of node.items) {
    addPair(record, pair);
  }
  return record;
}

function addPair(record: ConvertedMap, pair: Pair): void {
  if (pair.key instanceof Scalar && pair.key.mergeKey) {
    const sources = pair.value instanceof YAMLSeq ? pair.value.items : [pair.value];
    for (const source of sources) {
      // Node-only JSON has no alias resolution context, by design.
      if (!(source instanceof YAMLMap)) {
        throw new Error("Merge sources must be maps or map aliases");
      }
      const entries = nodeMapValue(source, true);
      mergeEntries(record, entries as Map<unknown, unknown> | Set<unknown>);
    }
    return;
  }
  const convertedKey = jsonValue(pair.key, "");
  if (record instanceof Set) {
    record.add(convertedKey);
  } else if (record instanceof Map) {
    record.set(convertedKey, jsonValue(pair.value, convertedKey));
  } else {
    const key = jsonKey(convertedKey);
    Object.defineProperty(record, key, {
      value: jsonValue(pair.value, key),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

export type Node<T = unknown> = Scalar<T> | Alias | YAMLMap<unknown, T> | YAMLSeq<T>;
export type ParsedNode =
  | (Scalar & { range: Range })
  | (Alias & { range: Range })
  | (YAMLMap<ParsedNode, ParsedNode | null> & { range: Range })
  | (YAMLSeq<ParsedNode | Pair<ParsedNode, ParsedNode | null>> & { range: Range });

export function isNode(value: unknown): value is Node {
  return value instanceof AstNode;
}
export function isMap(value: unknown): value is YAMLMap {
  return value instanceof AstNode && value.kind === "map";
}
export function isSeq(value: unknown): value is YAMLSeq {
  return value instanceof AstNode && value.kind === "seq";
}
export function isScalar(value: unknown): value is Scalar {
  return value instanceof AstNode && value.kind === "scalar";
}

interface YamlIssue extends Error {
  code: string;
  pos: [number, number];
}

export interface ParsedDocument {
  readonly contents: ParsedNode | null;
  readonly errors: YamlIssue[];
  readonly warnings: YamlIssue[];
  readonly range?: Range;
  get(key: unknown, keepScalar?: boolean): unknown;
  toJS(options?: { maxAliasCount?: number; mapAsMap?: boolean }): unknown;
  toJSON(arg?: string | null): unknown;
}
