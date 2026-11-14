import { loadOxcParser } from "./oxc-parser.ts";
import { importAuditDecisions, importSourceShape } from "./source-import-policy.ts";
import { sourceSuppressions } from "./source-suppressions.ts";
import { findInlineSnapshots } from "./jest-inline-snapshots.ts";
import {
  readStaticSourceTransfer,
  type StaticSourceTransfer,
} from "./source-audit-static-transfer.ts";
import type { Node, Program } from "oxc-parser";

export interface SourceProgramCapture {
  program: Program;
  visitorKeys: Record<string, string[]>;
  suppressed: (offset: number) => boolean;
  position: (offset: number) => { line: number; column: number };
}

export interface SourceImport {
  relativePath: string;
  source: string;
  line: number;
  column: number;
  names: string[];
  namespace: boolean;
  restricted: boolean;
  extensions: boolean;
  /** Lazy references are audited, but do not count as eagerly loaded barrel dependencies. */
  dynamic?: true;
}

export interface SourceWildcardExport {
  relativePath: string;
  line: number;
  column: number;
  source: string;
}
export interface SourceSnapshot {
  relativePath: string;
  line: number;
  column: number;
  lineCount: number;
}
export interface SourceFileAudit {
  imports: SourceImport[];
  wildcardExports: SourceWildcardExport[];
  snapshots: SourceSnapshot[];
}

export function sourcePositions(
  source: string,
): (offset: number) => { line: number; column: number } {
  const starts = [0];
  // Skip ordinary runs with the runtime's string search; retain all JS line breaks.
  if (!/[\r\u2028\u2029]/.test(source)) {
    for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1)) {
      starts.push(index + 1);
    }
  } else {
    const breaks = /\r\n|[\r\n\u2028\u2029]/g;
    for (let match = breaks.exec(source); match; match = breaks.exec(source)) {
      starts.push(match.index + match[0].length);
    }
  }
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle]! <= offset) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return { line: low + 1, column: offset - starts[low]! + 1 };
  };
}

/** Shared static facts; no source execution or module resolution. */
export async function parseSourceAudit(
  filename: string,
  source: string,
  resolvesOmittedExtension: (request: string) => boolean = () => false,
  syntaxFilename: string | { filename: string; positionSource: string } = filename,
  capture?: (parsed: SourceProgramCapture) => void,
): Promise<SourceFileAudit | undefined> {
  const { parseSync, visitorKeys, rawTransferSupported } = await loadOxcParser();
  const parserFilename =
    typeof syntaxFilename === "string" ? syntaxFilename : syntaxFilename.filename;
  const raw = rawTransferSupported();
  if (raw && !capture && !source.includes("InlineSnapshot")) {
    // Import-only rules need declarations, not function/class bodies. Normalize the
    // limited lazy schema explicitly; AST visitors and captures stay on eager ESTree.
    const metadataOptions: NonNullable<Parameters<typeof parseSync>[2]> & {
      experimentalLazy: boolean;
    } = { experimentalLazy: true };
    const metadata = parseSync(parserFilename, source, metadataOptions) as unknown as Pick<
      ReturnType<typeof parseSync>,
      "errors" | "module"
    > & { dispose(): void };
    try {
      if (metadata.errors.length) {
        return undefined;
      }
      if (!metadata.module.hasModuleSyntax && metadata.module.dynamicImports.length === 0) {
        return { imports: [], wildcardExports: [], snapshots: [] };
      }
      if (metadata.module.dynamicImports.length === 0) {
        const transferred = readStaticSourceTransfer(metadata, source, parserFilename);
        if (transferred) {
          return collect(transferred);
        }
      }
    } finally {
      // Also release before reparsing a module through the eager fallback.
      metadata.dispose();
    }
  }
  // Eager raw transfer preserves ESTree while avoiding JSON serialization and
  // parsing of every AST. Lazy transfer uses a different node schema; AST consumers
  // must use eager transfer. These experimental options are not in ParserOptions.
  const transferOptions: NonNullable<Parameters<typeof parseSync>[2]> & {
    experimentalRawTransfer: boolean;
  } = { experimentalRawTransfer: true };
  const eagerParsed = parseSync(parserFilename, source, raw ? transferOptions : undefined);
  if (eagerParsed.errors.length) {
    return undefined;
  }
  return collect(eagerParsed);

  function collect(parsed: ReturnType<typeof parseSync> | StaticSourceTransfer): SourceFileAudit {
    const eager = "staticOnly" in parsed ? undefined : parsed;
    // Component scaffolds may overwrite markup/newlines, but never shift offsets.
    const position = sourcePositions(
      typeof syntaxFilename === "string" ? source : syntaxFilename.positionSource,
    );
    const suppressed = sourceSuppressions(parsed.comments, (offset) => position(offset).line);
    if (eager) {
      capture?.({
        program: eager.program,
        visitorKeys,
        position,
        suppressed: (offset) => suppressed("jest/no-large-snapshots", offset),
      });
    }
    const facts: SourceImport[] = [];
    function add(
      start: number,
      request: string,
      runtime: boolean,
      names: string[],
      options: { namespace: boolean; dynamic?: true },
    ) {
      const shape = importSourceShape(request);
      if (
        shape.relative &&
        shape.hasExtension &&
        !shape.hasQuery &&
        resolvesOmittedExtension(request)
      ) {
        shape.hasExtension = false;
      }
      facts.push({
        relativePath: filename,
        source: request,
        ...position(start),
        names,
        namespace: options.namespace,
        ...(options.dynamic ? { dynamic: true as const } : {}),
        ...importAuditDecisions({
          runtime,
          hasBindings: options.namespace || names.length > 0,
          ...shape,
          restrictedSuppressed: suppressed("no-restricted-imports", start),
          extensionsSuppressed: suppressed("import/extensions", start),
        }),
      });
    }
    const wildcardExports: SourceWildcardExport[] = [];
    for (const declaration of parsed.program.body) {
      if (declaration.type === "ImportDeclaration") {
        const values =
          declaration.importKind === "type"
            ? []
            : declaration.specifiers.filter(
                (entry) => entry.type !== "ImportSpecifier" || entry.importKind !== "type",
              );
        add(
          declaration.start,
          declaration.source.value,
          declaration.importKind !== "type" &&
            (declaration.specifiers.length === 0 || values.length > 0),
          values.flatMap((entry) =>
            entry.type === "ImportDefaultSpecifier"
              ? ["default"]
              : entry.type === "ImportSpecifier"
                ? [
                    entry.imported.type === "Identifier"
                      ? entry.imported.name
                      : entry.imported.value,
                  ]
                : [],
          ),
          { namespace: values.some((entry) => entry.type === "ImportNamespaceSpecifier") },
        );
      } else if (declaration.type === "ExportNamedDeclaration" && declaration.source) {
        const values =
          declaration.exportKind === "type"
            ? []
            : declaration.specifiers.filter((entry) => entry.exportKind !== "type");
        add(
          declaration.start,
          declaration.source.value,
          values.length > 0,
          values.map((entry) =>
            entry.local.type === "Identifier" ? entry.local.name : entry.local.value,
          ),
          { namespace: false },
        );
      } else if (declaration.type === "ExportAllDeclaration") {
        if (!suppressed("oxc/no-barrel-file", declaration.start)) {
          wildcardExports.push({
            relativePath: filename,
            ...position(declaration.start),
            source: declaration.source.value,
          });
        }
        add(declaration.start, declaration.source.value, declaration.exportKind !== "type", [], {
          namespace: declaration.exportKind !== "type",
        });
      }
    }
    function visit(node: Node) {
      if (node.type === "ImportExpression") {
        const request =
          node.source.type === "Literal" && typeof node.source.value === "string"
            ? node.source.value
            : node.source.type === "TemplateLiteral" && node.source.expressions.length === 0
              ? node.source.quasis[0]?.value.cooked
              : undefined;
        if (request !== undefined && request !== null) {
          // The namespace is loaded regardless of how the promise result is consumed.
          add(node.start, request, true, [], { namespace: true, dynamic: true });
        }
      }
      const record = node as unknown as Record<string, unknown>;
      for (const key of visitorKeys[node.type] ?? []) {
        const value = record[key];
        for (const child of Array.isArray(value) ? value : [value]) {
          if (child && typeof child === "object" && "type" in child) {
            visit(child as Node);
          }
        }
      }
    }
    // Native module metadata also recognizes comments/whitespace and templates.
    // Avoid walking every expression in repositories with no dynamic imports.
    if (eager?.module.dynamicImports.length) {
      visit(eager.program);
      facts.sort((left, right) => left.line - right.line || left.column - right.column);
    }
    return {
      imports: facts,
      wildcardExports,
      snapshots:
        eager && source.includes("InlineSnapshot")
          ? findInlineSnapshots(eager.program, visitorKeys, (offset) =>
              suppressed("jest/no-large-snapshots", offset),
            ).map(({ offset, lineCount }) => ({
              relativePath: filename,
              ...position(offset),
              lineCount,
            }))
          : [],
    };
  }
}
