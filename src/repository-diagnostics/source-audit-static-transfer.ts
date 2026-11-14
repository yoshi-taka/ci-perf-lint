import type { Comment } from "oxc-parser";

type ModuleName = { type: "Identifier"; name: string } | { type: "Literal"; value: string };
type ImportKind = "type" | "value";
type ImportSpecifier =
  | { type: "ImportSpecifier"; imported: ModuleName; importKind: ImportKind }
  | { type: "ImportDefaultSpecifier" | "ImportNamespaceSpecifier" };
type StaticDeclaration =
  | {
      type: "ImportDeclaration";
      start: number;
      source: { value: string };
      importKind: ImportKind;
      specifiers: ImportSpecifier[];
    }
  | {
      type: "ExportNamedDeclaration";
      start: number;
      source: { value: string };
      exportKind: ImportKind;
      specifiers: { local: ModuleName; exportKind: ImportKind }[];
    }
  | {
      type: "ExportAllDeclaration";
      start: number;
      source: { value: string };
      exportKind: ImportKind;
    };

/** Detached fields consumed by the static collector, not an ESTree AST. */
export interface StaticSourceTransfer {
  staticOnly: true;
  program: { body: StaticDeclaration[] };
  comments: Comment[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function moduleName(value: unknown): ModuleName | undefined {
  const node = record(value);
  if (
    node &&
    ["IdentifierName", "Identifier", "BindingIdentifier"].includes(String(node.type)) &&
    typeof node.name === "string"
  ) {
    return { type: "Identifier", name: node.name };
  }
  if (node?.type === "StringLiteral" && typeof node.value === "string") {
    return { type: "Literal", value: node.value };
  }
  return undefined;
}

function importKind(value: unknown): value is ImportKind {
  return value === "type" || value === "value";
}

/** null skips unrelated declarations; undefined requests the eager fallback. */
function declaration(value: unknown): StaticDeclaration | null | undefined {
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
  const source = record(node.source);
  if (typeof source?.value !== "string" || typeof node.start !== "number") {
    return undefined;
  }
  const common = { start: node.start, source: { value: source.value } };
  if (node.type === "ImportDeclaration") {
    if (
      !importKind(node.importKind) ||
      (node.specifiers !== null && !Array.isArray(node.specifiers))
    ) {
      return undefined;
    }
    const specifiers: ImportSpecifier[] = [];
    // Native lazy imports use null for side-effect-only specifiers.
    for (const specifier of node.specifiers ?? []) {
      const entry = record(specifier);
      if (entry?.type === "ImportSpecifier") {
        const imported = moduleName(entry.imported);
        if (!imported || !importKind(entry.importKind)) {
          return undefined;
        }
        specifiers.push({ type: entry.type, imported, importKind: entry.importKind });
      } else if (
        entry?.type === "ImportDefaultSpecifier" ||
        entry?.type === "ImportNamespaceSpecifier"
      ) {
        specifiers.push({ type: entry.type });
      } else {
        return undefined;
      }
    }
    return { ...common, type: "ImportDeclaration", importKind: node.importKind, specifiers };
  }
  if (!importKind(node.exportKind)) {
    return undefined;
  }
  if (node.type === "ExportAllDeclaration") {
    return { ...common, type: node.type, exportKind: node.exportKind };
  }
  if (!Array.isArray(node.specifiers)) {
    return undefined;
  }
  const specifiers: { local: ModuleName; exportKind: ImportKind }[] = [];
  for (const specifier of node.specifiers) {
    const entry = record(specifier);
    const local = moduleName(entry?.local);
    if (!local || !importKind(entry?.exportKind)) {
      return undefined;
    }
    specifiers.push({ local, exportKind: entry.exportKind });
  }
  return { ...common, type: "ExportNamedDeclaration", exportKind: node.exportKind, specifiers };
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
  const body: StaticDeclaration[] = [];
  for (const node of program.body) {
    const normalized = declaration(node);
    if (normalized === undefined) {
      return undefined;
    }
    if (normalized !== null) {
      body.push(normalized);
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
  return { staticOnly: true, program: { body }, comments };
}
