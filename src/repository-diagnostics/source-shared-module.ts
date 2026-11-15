import type { PlaywrightModuleFacts } from "./playwright-route-detector.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
function identifier(value: unknown, lazy: boolean): string | undefined {
  const node = record(value);
  const types = lazy
    ? ["Identifier", "IdentifierName", "BindingIdentifier", "IdentifierReference"]
    : ["Identifier"];
  return node && types.includes(String(node.type)) && typeof node.name === "string"
    ? node.name
    : undefined;
}
export function emptyModuleFacts(): PlaywrightModuleFacts {
  return {
    importsPlaywrightTest: false,
    localImports: [],
    localTestImports: [],
    exportsTest: false,
  };
}
/** Match playwrightModuleFacts, detaching native lazy/eager nodes before disposal. */
export function projectModuleFacts(
  program: unknown,
  lazy: boolean,
): PlaywrightModuleFacts | undefined {
  try {
    const body = record(program)?.body;
    if (!Array.isArray(body)) {
      return undefined;
    }
    let importsPlaywrightTest = false;
    let exportsTest = false;
    const localImports = new Set<string>();
    const localTestImports = new Set<string>();
    for (const value of body) {
      const node = record(value);
      if (typeof node?.type !== "string") {
        return undefined;
      }
      if (node.type === "ImportDeclaration") {
        const source = record(node.source)?.value;
        if (typeof source !== "string" || !["type", "value"].includes(String(node.importKind))) {
          return undefined;
        }
        if (!(lazy && node.specifiers === null) && !Array.isArray(node.specifiers)) {
          return undefined;
        }
        const specifiers = (node.specifiers ?? []) as unknown[];
        const entrypoint = source === "@playwright/test" || source === "playwright/test";
        // Preserve the original detector's type-import and string-name semantics.
        if (source.startsWith(".")) {
          localImports.add(source);
        }
        for (const item of specifiers) {
          const specifier = record(item);
          if (!specifier) {
            return undefined;
          }
          if (
            specifier.type !== "ImportSpecifier" &&
            specifier.type !== "ImportDefaultSpecifier" &&
            specifier.type !== "ImportNamespaceSpecifier"
          ) {
            return undefined;
          }
          if (
            specifier.type === "ImportSpecifier" &&
            !["type", "value"].includes(String(specifier.importKind))
          ) {
            return undefined;
          }
          if (
            entrypoint &&
            node.importKind !== "type" &&
            (specifier.type !== "ImportSpecifier" || specifier.importKind !== "type")
          ) {
            importsPlaywrightTest = true;
          }
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.importKind !== "type" &&
            identifier(specifier.imported, lazy) === "test" &&
            source.startsWith(".")
          ) {
            localTestImports.add(source);
          }
        }
      } else if (
        node.type === "ExportNamedDeclaration" ||
        (lazy && node.type === "ExportFromDeclaration")
      ) {
        const declaration = record(node.declaration);
        if (declaration?.type === "VariableDeclaration") {
          if (!Array.isArray(declaration.declarations)) {
            return undefined;
          }
          for (const item of declaration.declarations) {
            if (identifier(record(item)?.id, lazy) === "test") {
              exportsTest = true;
            }
          }
        }
        if (!Array.isArray(node.specifiers)) {
          return undefined;
        }
        for (const item of node.specifiers) {
          if (identifier(record(item)?.exported, lazy) === "test") {
            exportsTest = true;
          }
        }
      } else if (node.type === "ExportDefaultDeclaration") {
        let declaration = record(node.declaration);
        let depth = 0;
        // The original detector parses with preserveParens:false.
        while (declaration?.type === "ParenthesizedExpression") {
          if (++depth > 32) {
            return undefined;
          }
          declaration = record(declaration.expression);
        }
        if (identifier(declaration, lazy) === "test") {
          exportsTest = true;
        }
      } else if (
        lazy &&
        /^(?:Import|Export)/.test(node.type) &&
        node.type !== "ExportAllDeclaration"
      ) {
        // Unknown native schema: retain the original parser/reader path.
        return undefined;
      }
    }
    return {
      importsPlaywrightTest,
      localImports: [...localImports],
      localTestImports: [...localTestImports],
      exportsTest,
    };
  } catch {
    return undefined;
  }
}
