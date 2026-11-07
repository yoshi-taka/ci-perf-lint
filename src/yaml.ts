import type { ParsedDocument } from "./yaml-ast.ts";
import { buildOwnedDocument } from "./yaml-owned-parse.ts";
import { parseYaml, type ParseDiagnostic, type ParseDocumentResult } from "./yaml-parse.ts";

export { YAMLMap, isMap, isNode, isScalar, isSeq } from "./yaml-ast.ts";
export { LineCounter } from "./yaml-line-counter.ts";
export type { Node, Pair, ParsedDocument } from "./yaml-ast.ts";

interface ParseOptions {
  lineCounter?: {
    lineStarts: number[];
    addNewLine(offset: number): number;
  };
  uniqueKeys?: boolean;
  keepSourceTokens?: boolean;
  prettyErrors?: boolean;
}

function toIssue(
  diagnostic: ParseDiagnostic,
  name: string,
): Error & {
  code: string;
  pos: [number, number];
  linePos: [{ line: number; col: number }, { line: number; col: number }];
} {
  const issue = new Error(diagnostic.message) as Error & {
    code: string;
    pos: [number, number];
    linePos: [{ line: number; col: number }, { line: number; col: number }];
  };
  issue.name = name;
  issue.code = diagnostic.code;
  issue.pos = [diagnostic.pos[0], diagnostic.pos[1]];
  issue.linePos = [
    { line: diagnostic.linePos[0].line, col: diagnostic.linePos[0].col },
    { line: diagnostic.linePos[1].line, col: diagnostic.linePos[1].col },
  ];
  return issue;
}

function fatalDocument(source: string, error: unknown): ParsedDocument {
  const message = error instanceof Error ? error.message : String(error);
  const issue = toIssue(
    {
      code: "UNEXPECTED_TOKEN",
      message,
      pos: [0, 0],
      linePos: [
        { line: 1, col: 1 },
        { line: 1, col: 1 },
      ],
    },
    "YAMLParseError",
  );
  return {
    contents: null,
    errors: [issue],
    warnings: [],
    range: [0, source.length, source.length],
    get: () => undefined,
    toJS: () => null,
    toJSON: () => null,
  };
}

function withoutLocation(message: string): string {
  return message.replace(/ at line \d+, column \d+:[\s\S]*$/, "");
}

function adjustDiagnostics(
  result: ParseDocumentResult,
  options: ParseOptions,
): ParseDocumentResult {
  let errors = result.errors;
  let warnings = result.warnings;
  if (options.uniqueKeys === false) {
    errors = errors.filter((diagnostic) => diagnostic.code !== "DUPLICATE_KEY");
  }
  if (options.prettyErrors === false) {
    errors = errors.map((diagnostic) => ({
      ...diagnostic,
      message: withoutLocation(diagnostic.message),
    }));
    warnings = warnings.map((diagnostic) => ({
      ...diagnostic,
      message: withoutLocation(diagnostic.message),
    }));
  }
  return errors === result.errors && warnings === result.warnings
    ? result
    : { ...result, errors, warnings };
}

/**
 * Parse YAML with the repository-owned parser.
 * Invalid input returns diagnostics rather than throwing; only an internal
 * parser failure produces a single synthetic diagnostic.
 */
export function parseDocument(source: string, options: ParseOptions = {}): ParsedDocument {
  const counter = options.lineCounter;
  if (counter) {
    counter.lineStarts.push(0);
    for (let index = 0; index < source.length; index++) {
      if (source.charCodeAt(index) === 10) {
        counter.lineStarts.push(index + 1);
      }
    }
  }
  try {
    const result = adjustDiagnostics(parseYaml(source), options);
    return buildOwnedDocument(result);
  } catch (error) {
    return fatalDocument(source, error);
  }
}
