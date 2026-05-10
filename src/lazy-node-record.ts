import type { Node } from "yaml";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function nodeToRecord(node: Node | undefined): Record<string, unknown> | undefined {
  if (!node) {
    return undefined;
  }
  const value = node.toJSON();
  return asRecord(value);
}

export function lazyNodeRecord(node: Node | undefined): () => Record<string, unknown> {
  let cached: Record<string, unknown> | undefined;
  let loaded = false;

  return () => {
    if (loaded) {
      return cached ?? {};
    }

    loaded = true;
    cached = nodeToRecord(node) ?? {};
    return cached;
  };
}

export function lazyOptionalNodeRecord(
  node: Node | undefined,
): () => Record<string, unknown> | undefined {
  let cached: Record<string, unknown> | undefined;
  let loaded = false;

  return () => {
    if (loaded) {
      return cached;
    }

    loaded = true;
    cached = nodeToRecord(node);
    return cached;
  };
}
