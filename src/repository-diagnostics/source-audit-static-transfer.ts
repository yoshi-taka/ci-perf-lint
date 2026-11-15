import type { Comment } from "oxc-parser";

interface StaticReference {
  start: number;
  source: string;
  runtime: boolean;
  names: string[];
  namespace: boolean;
  wildcard: boolean;
}

/** Detached final reference fields, without declaration/specifier AST-shaped objects. */
export interface StaticSourceTransfer {
  staticOnly: true;
  references: StaticReference[];
  comments: Comment[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function moduleName(value: unknown): string | undefined {
  const node = record(value);
  if (
    node &&
    ["IdentifierName", "Identifier", "BindingIdentifier"].includes(String(node.type)) &&
    typeof node.name === "string"
  ) {
    return node.name;
  }
  if (node?.type === "StringLiteral" && typeof node.value === "string") {
    return node.value;
  }
  return undefined;
}

function importKind(value: unknown): value is "type" | "value" {
  return value === "type" || value === "value";
}

/** null skips unrelated declarations; undefined requests the eager fallback. */
function reference(value: unknown): StaticReference | null | undefined {
  const node = record(value);
  if (!node || typeof node.type !== "string") {
    return undefined;
  }
  if (
    node.type !== "ImportDeclaration" &&
    node.type !== "ExportFromDeclaration" &&
    node.type !== "ExportAllDeclaration" &&
    !(node.type === "ExportNamedDeclaration" && node.source)
  ) {
    if (
      /^(?:Import|Export)/.test(node.type) &&
      node.type !== "ExportNamedDeclaration" &&
      node.type !== "ExportDefaultDeclaration"
    ) {
      return undefined;
    }
    return null;
  }
  const source = record(node.source)?.value;
  if (typeof source !== "string" || typeof node.start !== "number") {
    return undefined;
  }
  const names: string[] = [];
  let namespace = false;
  let runtime = false;
  if (node.type === "ImportDeclaration") {
    if (
      !importKind(node.importKind) ||
      (node.specifiers !== null && !Array.isArray(node.specifiers))
    ) {
      return undefined;
    }
    const specifiers = node.specifiers ?? [];
    let valueCount = 0;
    // Native lazy imports use null for side-effect-only specifiers.
    for (const specifier of specifiers) {
      const entry = record(specifier);
      if (entry?.type === "ImportSpecifier") {
        const imported = moduleName(entry.imported);
        if (imported === undefined || !importKind(entry.importKind)) {
          return undefined;
        }
        if (node.importKind === "value" && entry.importKind === "value") {
          names.push(imported);
          valueCount++;
        }
      } else if (
        entry?.type === "ImportDefaultSpecifier" ||
        entry?.type === "ImportNamespaceSpecifier"
      ) {
        if (node.importKind === "value") {
          valueCount++;
          if (entry.type === "ImportDefaultSpecifier") {
            names.push("default");
          } else {
            namespace = true;
          }
        }
      } else {
        return undefined;
      }
    }
    runtime = node.importKind === "value" && (specifiers.length === 0 || valueCount > 0);
  } else {
    if (!importKind(node.exportKind)) {
      return undefined;
    }
    if (node.type === "ExportAllDeclaration") {
      runtime = namespace = node.exportKind === "value";
    } else {
      if (!Array.isArray(node.specifiers)) {
        return undefined;
      }
      for (const specifier of node.specifiers) {
        const entry = record(specifier);
        const local = moduleName(entry?.local);
        if (local === undefined || !importKind(entry?.exportKind)) {
          return undefined;
        }
        if (node.exportKind === "value" && entry.exportKind === "value") {
          names.push(local);
        }
      }
      runtime = names.length > 0;
    }
  }
  return {
    start: node.start,
    source,
    runtime,
    names,
    namespace,
    wildcard: node.type === "ExportAllDeclaration",
  };
}

/**
 * Read only static module declarations and comments from native lazy transfer.
 * Body expressions are never traversed. Unexpected shapes fall back to eager.
 */
export function readStaticSourceTransfer(
  metadata: unknown,
  source: string,
  filename: string,
): StaticSourceTransfer | undefined {
  const native = record(metadata);
  const program = record(native?.program);
  if (!Array.isArray(program?.body) || !Array.isArray(native?.comments)) {
    return undefined;
  }
  const references: StaticReference[] = [];
  for (const node of program.body) {
    const normalized = reference(node);
    if (normalized === undefined) {
      return undefined;
    }
    if (normalized !== null) {
      references.push(normalized);
    }
  }
  const comments: Comment[] = [];
  for (const value of native.comments) {
    const comment = record(value);
    if (
      (comment?.type !== "Line" && comment?.type !== "Block") ||
      typeof comment.start !== "number" ||
      typeof comment.end !== "number"
    ) {
      return undefined;
    }
    const { start, end, type } = comment;
    comments.push({
      start,
      end,
      type,
      value: source.slice(start + 2, end - (type === "Block" ? 2 : 0)),
    });
  }
  // Match eager transfer: hashbangs become line comments for JavaScript, not TS.
  if (!/\.[cm]?tsx?$/i.test(filename) && program.hashbang) {
    const hashbang = record(program.hashbang);
    if (
      typeof hashbang?.start !== "number" ||
      typeof hashbang.end !== "number" ||
      typeof hashbang.value !== "string"
    ) {
      return undefined;
    }
    comments.unshift({
      start: hashbang.start,
      end: hashbang.end,
      value: hashbang.value,
      type: "Line",
    });
  }
  return { staticOnly: true, references, comments };
}
