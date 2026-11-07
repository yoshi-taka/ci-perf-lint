// Independent YAML 1.2/1.1 document parser for milestone 1.
// Implemented directly from the YAML 1.2.2 specification and public parse
// observations. Produces decoded, resolved nodes with source ranges and
// comment metadata, and delegates scalar/collection tag resolution to the
// separately authored resolver modules.

import { resolveScalarTag } from "./yaml-scalar-resolve.ts";
import { scalarTagTest } from "./yaml-scalar-tags.ts";
import { resolveCollectionTag, resolveMergeTag } from "./yaml-collection-resolve.ts";

type Range = [number, number, number];

export interface ParseScalarNode {
  kind: "scalar";
  value: unknown;
  type: string;
  source: string;
  format: string | undefined;
  minFractionDigits: number | undefined;
  mergeKey: boolean | undefined;
  tag: string | undefined;
  anchor: string | undefined;
  range: Range;
  comment: string | undefined;
  commentBefore: string | undefined;
  spaceBefore: boolean | undefined;
}

export interface ParseAliasNode {
  kind: "alias";
  source: string;
  tag: string | undefined;
  anchor: string | undefined;
  range: Range;
  comment: string | undefined;
  commentBefore: string | undefined;
  spaceBefore: boolean | undefined;
}

export interface ParsePairNode {
  kind: "pair";
  key: ParseNode | null;
  value: ParseNode | null;
}

export interface ParseMapNode {
  kind: "map";
  items: ParsePairNode[];
  collectionType: "set" | "omap" | undefined;
  tag: string | undefined;
  anchor: string | undefined;
  range: Range;
  comment: string | undefined;
  commentBefore: string | undefined;
  spaceBefore: boolean | undefined;
}

export interface ParseSeqNode {
  kind: "seq";
  items: ParseNode[];
  collectionType: "set" | "omap" | undefined;
  tag: string | undefined;
  anchor: string | undefined;
  range: Range;
  comment: string | undefined;
  commentBefore: string | undefined;
  spaceBefore: boolean | undefined;
}

export type ParseNode = ParseScalarNode | ParseAliasNode | ParseMapNode | ParseSeqNode;

export interface ParseDiagnostic {
  code: string;
  message: string;
  pos: [number, number];
  linePos: [{ line: number; col: number }, { line: number; col: number }];
}

export interface ParseDocumentResult {
  contents: ParseNode | null;
  errors: ParseDiagnostic[];
  warnings: ParseDiagnostic[];
  range: [number, number, number];
  schema: "core" | "yaml-1.1";
  tags: Record<string, string>;
  version: string | null;
  explicitVersion: boolean;
}

interface Trivia {
  comments: string[];
  blank: boolean;
  end: number;
}

interface Properties {
  tag?: string;
  anchor?: string;
  tagRange?: [number, number];
}

const DEFAULT_TAGS: Record<string, string> = { "!!": "tag:yaml.org,2002:" };

function makeScalar(value: unknown): ParseScalarNode {
  return {
    kind: "scalar",
    value,
    type: "PLAIN",
    source: "",
    format: undefined,
    minFractionDigits: undefined,
    mergeKey: undefined,
    tag: undefined,
    anchor: undefined,
    range: [0, 0, 0],
    comment: undefined,
    commentBefore: undefined,
    spaceBefore: undefined,
  };
}

function makeAlias(): ParseAliasNode {
  return {
    kind: "alias",
    source: "",
    tag: undefined,
    anchor: undefined,
    range: [0, 0, 0],
    comment: undefined,
    commentBefore: undefined,
    spaceBefore: undefined,
  };
}

function makePair(key: ParseNode | null, value: ParseNode | null): ParsePairNode {
  return { kind: "pair", key, value };
}

function makeMap(): ParseMapNode {
  return {
    kind: "map",
    items: [],
    collectionType: undefined,
    tag: undefined,
    anchor: undefined,
    range: [0, 0, 0],
    comment: undefined,
    commentBefore: undefined,
    spaceBefore: undefined,
  };
}

function makeSeq(): ParseSeqNode {
  return {
    kind: "seq",
    items: [],
    collectionType: undefined,
    tag: undefined,
    anchor: undefined,
    range: [0, 0, 0],
    comment: undefined,
    commentBefore: undefined,
    spaceBefore: undefined,
  };
}

function hasTrailingEmptyValue(node: ParseNode): boolean {
  if (node.kind === "scalar") {
    return node.source === "" && node.comment === undefined;
  }
  if (node.kind === "map") {
    const last = node.items[node.items.length - 1];
    if (last === undefined) {
      return false;
    }
    if (last.value === null) {
      return last.key !== null && (last.key.kind !== "scalar" || last.key.source === "");
    }
    return hasTrailingEmptyValue(last.value);
  }
  if (node.kind === "seq") {
    const last = node.items[node.items.length - 1];
    return last !== undefined && hasTrailingEmptyValue(last);
  }
  return false;
}

function isBlockScalar(node: ParseNode): boolean {
  return node.kind === "scalar" && (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED");
}

function normalizeComment(text: string): string {
  return text.length === 0 ? " " : text;
}

function appendComment(node: ParseNode, text: string): void {
  node.comment = node.comment ? `${node.comment}\n${text}` : text;
}

function attachBefore(node: ParseNode, trivia: Trivia): void {
  if (trivia.comments.length > 0) {
    const text = trivia.comments.join("\n");
    if (text.length > 0) {
      node.commentBefore = node.commentBefore ? `${text}\n${node.commentBefore}` : text;
    }
  }
  if (trivia.blank) {
    node.spaceBefore = true;
  }
}

const ANCHOR_STOP = " \t\r\n,[]{}";

class Parser {
  private readonly src: string;
  private readonly n: number;
  private i = 0;
  private steps = 0;
  private pendingComments: string[] = [];
  private pendingBlank = false;
  private pendingBlankBefore = false;
  private pendingCommentEnd = 0;
  private pendingCommentLineEnd = 0;
  private pendingCommentIndent = -1;
  private rootFirst = false;
  private plainIndent: number | undefined;
  private plainContext: "map" | "seq" | null = null;
  private flowDepth = 0;
  private flowLimit: number | null = null;
  private documentStartOverride: number | null = null;
  private trailingDocEnd: number | null = null;
  private flowRootEnd: number | null = null;
  private suppressTrailing = false;
  private flowCommentEnd: number | null = null;
  private flowCloseEnd: number | null = null;
  private seqItemRecovery = false;
  private explicitCommaDocEnd: number | null = null;
  private seqFirstItem = false;
  private commaRecovery: {
    commaStart: number;
    colon: number;
    valueStart: number;
    valueEnd: number;
  } | null = null;
  private virtualFold: {
    start: number;
    end: number;
    startLine: number;
    startCol: number;
    endLine: number;
    shift: number;
  } | null = null;
  private deferredDirectiveError: { start: number; end: number } | null = null;
  private readonly errors: ParseDiagnostic[] = [];
  private readonly warnings: ParseDiagnostic[] = [];
  private blockCollectionDepth = 0;
  private schema: "core" | "yaml-1.1" = "core";
  private version: string | null = "1.2";
  private explicitVersion = false;
  private tags: Record<string, string> = { ...DEFAULT_TAGS };

  constructor(src: string) {
    this.src = src;
    this.n = src.length;
  }

  private tick(): void {
    this.steps += 1;
    if (this.steps > 2000000) {
      throw new Error("step limit exceeded");
    }
  }

  recordError(code: string, base: string, start: number, end: number): void {
    this.errors.push(this.makeDiagnostic(code, base, start, end));
  }

  recordErrorSorted(code: string, base: string, start: number, end: number): void {
    if (this.errors.some((error) => error.code === code && error.pos[0] === start)) {
      return;
    }
    const diagnostic = this.makeDiagnostic(code, base, start, end);
    let index = this.errors.length;
    while (index > 0 && this.errors[index - 1]!.pos[0] > start) {
      index -= 1;
    }
    this.errors.splice(index, 0, diagnostic);
  }

  private recordSoftError(code: string, base: string, start: number, end: number): void {
    const diagnostic = this.makeDiagnostic(code, base, start, end);
    Object.defineProperty(diagnostic, "soft", { value: true, enumerable: false });
    this.errors.push(diagnostic);
  }

  recordWarning(code: string, base: string, start: number, end: number): void {
    this.warnings.push(this.makeDiagnostic(code, base, start, end));
  }

  private recordFoldedToken(base: string, start: number, end: number): void {
    const startPos = this.linePosAt(start);
    const rawEndPos = this.linePosAt(end);
    this.virtualFold = {
      start,
      end,
      startLine: startPos.line,
      startCol: startPos.col,
      endLine: rawEndPos.line,
      shift: rawEndPos.line - startPos.line,
    };
    const lines = this.src.split("\n");
    const current = (lines[startPos.line - 1] ?? "").replace(/\r$/, "");
    const firstNonSpace = current.length - current.replace(/^[ \t]*/, "").length + 1;
    const previous =
      startPos.line > 1 && (startPos.col === 1 || startPos.col === firstNonSpace)
        ? (lines[startPos.line - 2] ?? "").replace(/\r$/, "")
        : null;
    const body: string[] = [];
    for (let line = startPos.line; line <= rawEndPos.line; line += 1) {
      body.push((lines[line - 1] ?? "").replace(/\r$/, ""));
    }
    const caretCount = Math.max(1, end - start);
    const lastFrame = this.truncateCurrentLine(body[body.length - 1] ?? "", startPos.col);
    const prefixBody = body.slice(0, -1).map((line) => this.truncateLine(line));
    const caret = `${" ".repeat(Math.max(0, lastFrame.col - 1))}${"^".repeat(caretCount)}`;
    const excerpt = `${previous !== null ? `${this.truncateLine(previous)}\n` : ""}${[...prefixBody, lastFrame.text].join("\n")}\n${caret}`;
    this.errors.push({
      code: "UNEXPECTED_TOKEN",
      message: `${base} at line ${startPos.line}, column ${startPos.col}:\n\n${excerpt}\n`,
      pos: [start, end],
      linePos: [startPos, { line: startPos.line, col: startPos.col + caretCount }],
    });
  }

  private makeDiagnostic(code: string, base: string, start: number, end: number): ParseDiagnostic {
    const startPos = this.linePosAt(start);
    const endPos = this.linePosAt(end);
    const lines = this.src.split("\n");
    const current = (lines[startPos.line - 1] ?? "").replace(/\r$/, "");
    const firstNonSpace = current.length - current.replace(/^[ \t]*/, "").length + 1;
    const previous =
      startPos.line > 1 && (startPos.col === 1 || startPos.col === firstNonSpace)
        ? (lines[startPos.line - 2] ?? "").replace(/\r$/, "")
        : null;
    const sameLine = startPos.line === endPos.line;
    const caretCount = sameLine ? Math.max(1, endPos.col - startPos.col) : 1;
    const currentFrame = this.truncateCurrentLine(current, startPos.col);
    const caret = `${" ".repeat(Math.max(0, currentFrame.col - 1))}${"^".repeat(caretCount)}`;
    const excerpt = `${previous !== null ? `${this.truncateLine(previous)}\n` : ""}${currentFrame.text}\n${caret}`;
    return {
      code,
      message: `${base} at line ${startPos.line}, column ${startPos.col}:\n\n${excerpt}\n`,
      pos: [start, end],
      linePos: [startPos, endPos],
    };
  }

  private truncateLine(text: string): string {
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  }

  private truncateCurrentLine(text: string, col: number): { text: string; col: number } {
    if (text.length <= 80) {
      return { text, col };
    }
    if (col <= 60) {
      return { text: `${text.slice(0, 79)}…`, col };
    }
    let start = Math.min(text.length - 79, col - 40);
    if (start <= 0) {
      return { text: `${text.slice(0, 79)}…`, col };
    }
    if (start < 0) {
      start = 0;
    }
    const remaining = text.length - start;
    if (remaining <= 79) {
      return { text: `…${text.slice(start)}`, col: col - start + 1 };
    }
    return { text: `…${text.slice(start, start + 78)}…`, col: col - start + 1 };
  }

  private linePosAt(pos: number): { line: number; col: number } {
    let line = 1;
    let lineStart = 0;
    for (let index = 0; index < pos && index < this.n; index += 1) {
      if (this.src[index] === "\n") {
        line += 1;
        lineStart = index + 1;
      } else if (this.src[index] === "\r") {
        if (this.src[index + 1] === "\n") {
          index += 1;
        }
        line += 1;
        lineStart = index + 1;
      }
    }
    return { line, col: pos - lineStart + 1 };
  }

  private findIndentTab(): number {
    let lineStart = 0;
    while (lineStart < this.n) {
      if (this.src[lineStart] === "\t") {
        let probe = lineStart;
        while (probe < this.n && (this.src[probe] === " " || this.src[probe] === "\t")) {
          probe += 1;
        }
        if (probe < this.n && this.src[probe] !== "#" && !this.isLineBreak(probe)) {
          return lineStart;
        }
      }
      const next = this.src.indexOf("\n", lineStart);
      if (next === -1) {
        break;
      }
      lineStart = next + 1;
    }
    return -1;
  }

  parse(): ParseDocumentResult {
    if (this.src.charCodeAt(0) === 0xfeff) {
      this.i = 1;
    }
    const tabPos = this.findIndentTab();
    if (tabPos !== -1) {
      this.recordError("TAB_AS_INDENT", "Tabs are not allowed as indentation", tabPos, tabPos + 1);
      if (tabPos === 0) {
        this.documentStartOverride = 0;
      }
    }
    let markerPos: number | null = null;
    let sawDirective = false;
    this.collectTrivia();
    while (this.i < this.n && this.atAbsoluteLineStart(this.i) && this.src[this.i] === "%") {
      this.parseDirective();
      sawDirective = true;
      this.pendingComments = [];
      this.pendingBlank = false;
      this.pendingBlankBefore = false;
      this.pendingCommentEnd = 0;
      this.pendingCommentLineEnd = 0;
      this.pendingCommentIndent = -1;
      this.collectTrivia();
    }
    if (
      sawDirective &&
      this.i >= this.n &&
      !this.warnings.some((warning) => warning.code === "BAD_DIRECTIVE")
    ) {
      this.recordWarning(
        "BAD_DIRECTIVE",
        "Directive without document content",
        0,
        Math.min(1, this.n),
      );
    }
    if (sawDirective) {
      this.pendingComments = [];
      this.pendingBlank = false;
      this.pendingBlankBefore = false;
      this.pendingCommentEnd = 0;
      this.pendingCommentLineEnd = 0;
      this.pendingCommentIndent = -1;
    }
    if (
      sawDirective &&
      this.i < this.n &&
      this.i > this.lineStartIndex(this.i) &&
      this.src.startsWith("---", this.i) &&
      this.isSep(this.i + 3)
    ) {
      const lineStart = this.lineStartIndex(this.i);
      this.documentStartOverride = lineStart;
      const node = this.parsePlain(false, -1, true);
      this.finishInline(node);
      if (node.comment !== undefined) {
        this.deferredDirectiveError = { start: lineStart, end: lineStart + 1 };
      } else {
        this.recordError(
          "MISSING_CHAR",
          "Missing directives-end/doc-start indicator line",
          lineStart,
          lineStart + 1,
        );
      }
      return this.finishDocument(null, node);
    }
    if (this.src[0] === "\t" && this.src.startsWith("---", 1) && this.isSep(4)) {
      this.i = 1;
      const node = this.parsePlain(false, -1, true);
      this.finishInline(node);
      return this.finishDocument(null, node);
    }
    if (this.atDocStart()) {
      const startLine = this.lineStartIndex(this.i);
      if (startLine !== this.i) {
        this.documentStartOverride = startLine;
      }
      markerPos = this.i;
      this.i += 3;
      this.rootFirst = false;
      this.pendingComments = [];
      this.pendingBlank = false;
      this.pendingBlankBefore = false;
      this.pendingCommentEnd = 0;
      this.pendingCommentLineEnd = 0;
      this.pendingCommentIndent = -1;
      return this.finishExplicit(markerPos);
    }
    return this.finishImplicit();
  }

  private finishExplicit(markerPos: number): ParseDocumentResult {
    const emptyPos = this.skipInlineSpaces();
    const propStart = this.i;
    if (propStart < this.n && (this.src[propStart] === "&" || this.src[propStart] === "!")) {
      const props = this.parseProperties();
      const propEnd = this.i;
      this.skipInlineSpaces();
      if (this.i >= this.n || this.isLineBreak(this.i) || this.src[this.i] === "#") {
        this.collectTrivia();
        const nextCol = this.i < this.n ? this.lineIndent() : -1;
        const parentIndent = -1;
        if (nextCol > parentIndent && this.i < this.n && !this.atDocMarker()) {
          const node = this.parseBlockNode(parentIndent + 1, true);
          if (node) {
            this.applyProperties(node, props);
            return this.finishDocument(markerPos, node);
          }
        }
        const empty = makeScalar(null);
        empty.source = "";
        empty.range = [propEnd, propEnd, propEnd];
        this.applyProperties(empty, props);
        this.pendingComments = [];
        this.pendingBlank = false;
        this.pendingBlankBefore = false;
        this.pendingCommentEnd = 0;
        this.pendingCommentLineEnd = 0;
        this.pendingCommentIndent = -1;
        return this.finishDocument(markerPos, empty);
      }
      this.i = propStart;
    }
    let markerComment: Trivia | null = null;
    if (this.i < this.n && this.src[this.i] === "#") {
      markerComment = this.readSameLineComment();
    } else if (this.i < this.n && !this.isLineBreak(this.i)) {
      const rootNode = this.parseBlockNode(0, true, true);
      if (rootNode) {
        const node = this.maybeComposeNestedMap(rootNode) ?? rootNode;
        return this.finishDocument(markerPos, node);
      }
    } else {
      this.i = this.consumeLineBreak();
    }
    this.collectTrivia();
    const node = this.parseRootAfterMarker(emptyPos, markerComment);
    return this.finishDocument(markerPos, node);
  }

  private parseRootAfterMarker(emptyPos: number, markerComment: Trivia | null): ParseNode {
    if (this.i < this.n && !this.atDocEnd()) {
      const rootNode = this.parseBlockNode(0, true, true);
      if (rootNode) {
        const node = this.maybeComposeNestedMap(rootNode) ?? rootNode;
        if (markerComment) {
          attachBefore(node, markerComment);
        }
        return node;
      }
    }
    const node = makeScalar(null);
    const start = emptyPos;
    let end = emptyPos;
    const comments: string[] = [];
    if (markerComment) {
      comments.push(...markerComment.comments);
      end = Math.max(end, markerComment.end);
    }
    if (this.pendingComments.length > 0) {
      if (markerComment && this.pendingBlank) {
        comments.push("");
      }
      comments.push(...this.pendingComments);
      end = Math.max(end, this.pendingCommentEnd);
    } else if (markerComment && this.pendingBlank) {
      comments.push("");
    }
    const text = comments.join("\n");
    if (text.length > 0) {
      node.comment = text;
    }
    if (this.pendingBlankBefore && !markerComment) {
      node.spaceBefore = true;
    }
    const commentEnd = comments.length > 0 ? this.i : end;
    this.pendingComments = [];
    this.pendingBlank = false;
    this.pendingBlankBefore = false;
    this.pendingCommentEnd = 0;
    this.pendingCommentLineEnd = 0;
    this.pendingCommentIndent = -1;
    node.range = [start, start, commentEnd];
    return node;
  }

  private finishImplicit(): ParseDocumentResult {
    if (this.i >= this.n) {
      return this.emptyDocument();
    }
    if (this.atDocEnd()) {
      const node = makeScalar(null);
      node.range = [0, 0, 0];
      return this.finishDocument(0, node);
    }
    this.rootFirst = true;
    let rootStart = this.documentStartOverride ?? this.i;
    const rootLineStart = this.lineStartIndex(rootStart);
    if (rootLineStart !== rootStart) {
      rootStart = rootLineStart;
    }
    const rootNode = this.parseBlockNode(0, false, true);
    if (!rootNode) {
      return this.emptyDocument();
    }
    const node = this.maybeComposeNestedMap(rootNode) ?? rootNode;
    return this.finishDocument(null, node, rootStart);
  }

  private emptyDocument(): ParseDocumentResult {
    return {
      contents: null,
      errors: this.errors,
      warnings: this.warnings,
      range: [0, this.n, this.n],
      schema: this.schema,
      tags: this.tags,
      version: this.version,
      explicitVersion: this.explicitVersion,
    };
  }

  private reportTrailingTokens(
    startStream: boolean,
    streamLabel = "YAML stream",
    rootKind = "",
    rootStart = 0,
  ): void {
    let stream = startStream;
    let firstToken = true;
    let nodeLine: number | null = null;
    const startPos = this.i;
    let lastNodeEnd: number | null = null;
    let firstStreamStart: number | null = null;
    while (this.i < this.n) {
      this.collectTrivia();
      if (this.i >= this.n || this.atDocMarker()) {
        break;
      }
      if (!stream && firstToken && this.src[this.i] === ",") {
        let commaEnd = this.lineEnd(this.i);
        while (
          commaEnd > this.i &&
          (this.src[commaEnd - 1] === " " || this.src[commaEnd - 1] === "\t")
        ) {
          commaEnd -= 1;
        }
        let commaColon = -1;
        for (let probe = this.i; probe < commaEnd; probe += 1) {
          if (this.src[probe] === ":" && (probe + 1 >= this.n || this.isSep(probe + 1))) {
            commaColon = probe;
            commaEnd = probe;
            break;
          }
        }
        if (commaColon !== -1) {
          let valueStart = commaColon + 1;
          while (
            valueStart < this.n &&
            (this.src[valueStart] === " " || this.src[valueStart] === "\t")
          ) {
            valueStart += 1;
          }
          let valueEnd = this.lineEnd(commaColon);
          while (
            valueEnd > valueStart &&
            (this.src[valueEnd - 1] === " " || this.src[valueEnd - 1] === "\t")
          ) {
            valueEnd -= 1;
          }
          if (valueStart < valueEnd) {
            this.commaRecovery = {
              commaStart: this.i,
              colon: commaColon,
              valueStart,
              valueEnd,
            };
          }
        }
        if (commaEnd > this.i) {
          this.recordTrailingDiagnostic(
            "UNEXPECTED_TOKEN",
            "Unexpected scalar at node end",
            this.i,
            commaEnd,
          );
          this.i = this.lineEnd(this.i);
          firstToken = false;
          continue;
        }
      }
      if (firstToken && !stream && rootKind === "seq") {
        const lineStart = this.lineStartIndex(this.i);
        let probe = lineStart;
        while (probe < this.n && (this.src[probe] === " " || this.src[probe] === "\t")) {
          probe += 1;
        }
        const rootIndent = this.lineIndentOf(rootStart);
        if (probe > lineStart && probe < this.n && probe - lineStart > rootIndent) {
          if (this.src[probe] === "-" && this.isSep(probe + 1)) {
            this.recordError(
              "BAD_INDENT",
              "All sequence items must start at the same column",
              probe,
              probe + 1,
            );
            this.seqItemRecovery = true;
            this.i = this.n;
            break;
          }
          if (!"]},".includes(this.src[probe]!)) {
            this.recordError(
              "MISSING_CHAR",
              "Sequence item without - indicator",
              lineStart,
              lineStart + 1,
            );
            this.seqItemRecovery = true;
            this.i = this.n;
            break;
          }
        }
      }
      const token = this.scanDiagnosticToken(!stream);
      if (token === null) {
        break;
      }
      if (
        !stream &&
        !firstToken &&
        nodeLine !== null &&
        this.linePosAt(token.start).line > nodeLine
      ) {
        stream = true;
      }
      if (
        !stream &&
        firstToken &&
        (token.kind === "flow-seq-end" || token.kind === "flow-map-end")
      ) {
        stream = true;
      }
      if (!stream && (token.kind === "map-value-ind" || token.kind === "comma")) {
        stream = true;
        this.flushDeferredDirectiveError();
      }
      if (stream) {
        this.flushDeferredDirectiveError();
      }
      if (stream) {
        firstStreamStart ??= token.start;
        this.recordTrailingDiagnostic(
          "UNEXPECTED_TOKEN",
          `Unexpected ${token.name} token in ${streamLabel}: ${JSON.stringify(token.raw)}`,
          token.start,
          token.end,
        );
      } else {
        nodeLine ??= this.linePosAt(token.start).line;
        lastNodeEnd = this.tokenNodeEnd(token.end);
        const base = `Unexpected ${token.name} at node end`;
        if (token.kind === "scalar" && token.raw.includes("\n")) {
          this.recordFoldedToken(base, token.start, token.end);
        } else {
          this.recordTrailingDiagnostic("UNEXPECTED_TOKEN", base, token.start, token.end);
        }
      }
      if (!stream && token.kind === "alias") {
        stream = true;
      }
      if (!stream && (token.kind === "flow-seq-start" || token.kind === "flow-map-start")) {
        let probe = token.end;
        while (probe < this.n && (this.src[probe] === " " || this.src[probe] === "\t")) {
          probe += 1;
        }
        const close = token.kind === "flow-seq-start" ? "]" : "}";
        if (probe < this.n && this.src[probe] === close) {
          stream = true;
        }
      }
      this.i = token.end > this.i ? token.end : this.i + 1;
      firstToken = false;
    }
    this.trailingDocEnd = lastNodeEnd ?? firstStreamStart;
    this.flushDeferredDirectiveError();
    this.i = startPos;
  }

  private recordTrailingDiagnostic(code: string, base: string, start: number, end: number): void {
    const fold = this.virtualFold;
    if (fold === null || start < fold.end) {
      this.recordError(code, base, start, end);
      return;
    }
    const physical = this.linePosAt(start);
    let virtualLine: number;
    let virtualCol: number;
    if (physical.line === fold.endLine) {
      virtualLine = fold.startLine;
      virtualCol = fold.startCol + (start - fold.start);
    } else {
      virtualLine = physical.line - fold.shift;
      virtualCol = physical.col;
    }
    const lines = this.src.split("\n");
    const body: string[] = [];
    for (let line = fold.startLine; line <= physical.line; line += 1) {
      body.push((lines[line - 1] ?? "").replace(/\r$/, ""));
    }
    const caretCount = Math.max(1, end - start);
    const lastFrame = this.truncateCurrentLine(body[body.length - 1] ?? "", virtualCol);
    const prefixBody = body.slice(0, -1).map((line) => this.truncateLine(line));
    const caret = `${" ".repeat(Math.max(0, lastFrame.col - 1))}${"^".repeat(caretCount)}`;
    const excerpt = `${[...prefixBody, lastFrame.text].join("\n")}\n${caret}`;
    this.errors.push({
      code,
      message: `${base} at line ${virtualLine}, column ${virtualCol}:\n\n${excerpt}\n`,
      pos: [start, end],
      linePos: [
        { line: virtualLine, col: virtualCol },
        { line: virtualLine, col: virtualCol + caretCount },
      ],
    });
  }

  private flushDeferredDirectiveError(): void {
    if (this.deferredDirectiveError === null) {
      return;
    }
    this.recordError(
      "MISSING_CHAR",
      "Missing directives-end/doc-start indicator line",
      this.deferredDirectiveError.start,
      this.deferredDirectiveError.end,
    );
    this.deferredDirectiveError = null;
  }

  private tokenNodeEnd(end: number): number {
    let index = end;
    while (index < this.n && (this.src[index] === " " || this.src[index] === "\t")) {
      index += 1;
    }
    if (index < this.n && this.src[index] === "#") {
      index = this.lineEnd(index);
    }
    if (index < this.n && this.isLineBreak(index)) {
      index = this.afterLineBreak(index);
    }
    return index;
  }

  private scanDiagnosticToken(
    foldPlain: boolean,
  ): { kind: string; name: string; raw: string; start: number; end: number } | null {
    const start = this.i;
    const ch = this.src[start];
    const single = (
      kind: string,
      name: string,
    ): { kind: string; name: string; raw: string; start: number; end: number } => ({
      kind,
      name,
      raw: this.src.slice(start, start + 1),
      start,
      end: start + 1,
    });
    if (ch === ":") {
      const token = single("map-value-ind", "map-value-ind");
      token.raw = ":";
      return token;
    }
    if (ch === ",") {
      const token = single("comma", "comma");
      token.raw = ",";
      return token;
    }
    if (ch === "[") {
      const token = single("flow-seq-start", "flow-seq-start");
      token.raw = "[";
      return token;
    }
    if (ch === "]") {
      const token = single("flow-seq-end", "flow-seq-end");
      token.raw = "]";
      return token;
    }
    if (ch === "{") {
      const token = single("flow-map-start", "flow-map-start");
      token.raw = "{";
      return token;
    }
    if (ch === "}") {
      const token = single("flow-map-end", "flow-map-end");
      token.raw = "}";
      return token;
    }
    if (ch === "-" && this.isSep(start + 1)) {
      const token = single("seq-item-ind", "seq-item-ind");
      token.raw = "-";
      return token;
    }
    if (ch === "*" || ch === "&" || ch === "!") {
      let end = start + 1;
      if (ch === "!" && this.src.startsWith("!<", start)) {
        const close = this.src.indexOf(">", start + 2);
        end = close === -1 ? this.n : close + 1;
      } else {
        while (end < this.n && !ANCHOR_STOP.includes(this.src[end]!)) {
          end += 1;
        }
      }
      const kind = ch === "*" ? "alias" : ch === "&" ? "anchor" : "tag";
      return { kind, name: kind, raw: this.src.slice(start, end), start, end };
    }
    if (ch === '"' || ch === "'") {
      let end = start + 1;
      while (end < this.n) {
        if (ch === '"' && this.src[end] === "\\") {
          end += 2;
          continue;
        }
        if (this.src[end] === ch) {
          if (ch === "'" && this.src[end + 1] === "'") {
            end += 2;
            continue;
          }
          end += 1;
          break;
        }
        end += 1;
      }
      const name = ch === '"' ? "double-quoted-scalar" : "single-quoted-scalar";
      return { kind: name, name, raw: this.src.slice(start, end), start, end };
    }
    let end = start;
    while (end < this.n) {
      const current = this.src[end];
      if (current === "\n" || current === "\r") {
        if (!foldPlain) {
          break;
        }
        let probe = end;
        let breaks = 0;
        while (probe < this.n && (this.src[probe] === "\n" || this.src[probe] === "\r")) {
          probe = this.afterLineBreak(probe);
          breaks += 1;
        }
        let content = probe;
        while (content < this.n && (this.src[content] === " " || this.src[content] === "\t")) {
          content += 1;
        }
        const first = content < this.n ? this.src[content]! : "";
        if (
          breaks > 1 ||
          first === "" ||
          this.atDocMarkerAt(content) ||
          "#[]{}'\"*&!,".includes(first) ||
          (first === "-" && this.isSep(content + 1))
        ) {
          break;
        }
        end = content;
        continue;
      }
      if (
        current === "#" &&
        (end === start || this.src[end - 1] === " " || this.src[end - 1] === "\t")
      ) {
        break;
      }
      if (
        current === "," ||
        current === "[" ||
        current === "]" ||
        current === "{" ||
        current === "}"
      ) {
        break;
      }
      if (current === ":") {
        const next = end + 1 < this.n ? this.src[end + 1] : "";
        if (
          next === "" ||
          next === " " ||
          next === "\t" ||
          next === "\n" ||
          next === "\r" ||
          next === "," ||
          next === "]" ||
          next === "}"
        ) {
          break;
        }
      }
      end += 1;
    }
    let textEnd = end;
    while (textEnd > start && (this.src[textEnd - 1] === " " || this.src[textEnd - 1] === "\t")) {
      textEnd -= 1;
    }
    if (textEnd === start) {
      return null;
    }
    return {
      kind: "scalar",
      name: "scalar",
      raw: this.src.slice(start, textEnd),
      start,
      end: textEnd,
    };
  }

  private secondDocContentEnd(marker: number): number {
    let index = marker;
    let lastEnd = marker;
    while (index < this.n) {
      const lineStart = this.lineStartIndex(index);
      const end = this.lineEnd(index);
      const text = this.src.slice(lineStart, end).trim();
      if (
        index !== marker &&
        (this.src.startsWith("...", lineStart) || this.src.startsWith("---", lineStart))
      ) {
        break;
      }
      if (text.length > 0 && !text.startsWith("#")) {
        lastEnd = this.afterLineBreak(end);
      }
      const next = this.afterLineBreak(end);
      if (next === index) {
        break;
      }
      index = next;
    }
    return lastEnd;
  }

  private findEndMarkerAfter(pos: number): number | null {
    let index = pos;
    while (index < this.n) {
      const lineStart = this.lineStartIndex(index);
      let probe = lineStart;
      while (probe < this.n && this.src[probe] === " ") {
        probe += 1;
      }
      if (probe === lineStart && this.src.startsWith("...", probe) && this.isSep(probe + 3)) {
        return this.afterLineBreak(this.lineEnd(probe));
      }
      const next = this.src.indexOf("\n", index);
      if (next === -1) {
        break;
      }
      index = next + 1;
    }
    return null;
  }

  private endsWithExplicitKey(node: ParseNode): boolean {
    if (node.kind !== "map") {
      return false;
    }
    const last = node.items[node.items.length - 1];
    if (last === undefined || last.value !== null || last.key === null) {
      return false;
    }
    if (last.key.kind === "scalar" && last.key.source !== "") {
      return false;
    }
    return this.src.slice(node.range[2]).trim() === "";
  }

  private finishDocument(
    markerPos: number | null,
    node: ParseNode,
    rootStart?: number,
  ): ParseDocumentResult {
    this.collectTrivia();
    if (
      node.kind === "scalar" &&
      node.source === "" &&
      node.comment === undefined &&
      this.pendingComments.length > 0
    ) {
      node.comment = this.pendingComments.join("\n");
      node.range[2] = Math.max(node.range[2], this.pendingCommentEnd);
    }
    if (
      node.kind === "scalar" &&
      node.source === "" &&
      node.comment === undefined &&
      this.i < this.n &&
      (this.src[this.i] === "]" || this.src[this.i] === "}")
    ) {
      let probe = this.afterLineBreak(this.lineEnd(this.i));
      const found: string[] = [];
      while (probe < this.n) {
        let hash = probe;
        while (hash < this.n && (this.src[hash] === " " || this.src[hash] === "\t")) {
          hash += 1;
        }
        if (hash >= this.n || this.src[hash] !== "#") {
          break;
        }
        const end = this.lineEnd(hash);
        found.push(normalizeComment(this.src.slice(hash + 1, end)));
        probe = this.afterLineBreak(end);
      }
      if (found.length > 0) {
        node.comment = found.join("\n");
        node.range[2] = probe;
        node.spaceBefore = true;
        this.flowCommentEnd = probe;
      }
    }
    const trailingComments = this.pendingComments.length > 0;
    const hadTrailing = trailingComments || this.pendingBlank;
    if (!this.suppressTrailing) {
      const emptyDocument =
        node.kind === "scalar" &&
        node.source === "" &&
        node.anchor === undefined &&
        node.tag === undefined;
      this.reportTrailingTokens(
        trailingComments,
        emptyDocument ? "YAML document" : "YAML stream",
        node.kind,
        node.range[0],
      );
    }
    this.applyCommaRecovery(node);
    if (this.seqItemRecovery) {
      this.seqItemRecovery = false;
      const path: ParseSeqNode[] = [];
      let container: ParseNode = node;
      while (container.kind === "seq") {
        path.push(container);
        const last = container.items[container.items.length - 1];
        if (last?.kind === "seq" && last.range[2] <= this.i) {
          container = last;
          continue;
        }
        break;
      }
      if (container.kind === "seq") {
        this.skipInlineSpaces();
        const indent = this.column();
        const parsed = this.parseBlockNode(indent, true);
        if (parsed !== null) {
          container.items.push(parsed);
          const end = parsed.range[2];
          for (const seq of path) {
            seq.range[1] = end;
            seq.range[2] = end;
          }
          node.range[1] = Math.max(node.range[1], end);
          node.range[2] = Math.max(node.range[2], end);
          const containerIndent = this.lineIndentOf(container.range[0]);
          for (;;) {
            this.collectTrivia();
            if (this.i >= this.n || this.atDocMarker() || this.column() < containerIndent) {
              break;
            }
            if (
              this.column() !== containerIndent ||
              this.src[this.i] !== "-" ||
              !this.isSep(this.i + 1)
            ) {
              if (this.column() > containerIndent && !this.atDocMarker()) {
                this.recordError(
                  "MISSING_CHAR",
                  "Sequence item without - indicator",
                  this.lineStartIndex(this.i),
                  this.lineStartIndex(this.i) + 1,
                );
                const beforeNested = this.i;
                const nestedItem = this.parseBlockNode(this.column(), true);
                if (nestedItem === null || this.i <= beforeNested) {
                  break;
                }
                container.items.push(nestedItem);
                const nestedEnd = nestedItem.range[2];
                for (const seq of path) {
                  seq.range[1] = nestedEnd;
                  seq.range[2] = nestedEnd;
                }
                node.range[1] = Math.max(node.range[1], nestedEnd);
                node.range[2] = Math.max(node.range[2], nestedEnd);
                continue;
              }
              break;
            }
            const beforeItem = this.i;
            this.i += 1;
            const nextItem = this.parseIndicatorValue(containerIndent, true);
            if (this.i <= beforeItem) {
              break;
            }
            container.items.push(nextItem);
            const nextEnd = nextItem.range[2];
            for (const seq of path) {
              seq.range[1] = nextEnd;
              seq.range[2] = nextEnd;
            }
            node.range[1] = Math.max(node.range[1], nextEnd);
            node.range[2] = Math.max(node.range[2], nextEnd);
          }
        }
      }
    }
    let docEnd = this.n;
    if (this.atDocEnd()) {
      const markerStart = this.i;
      const lineEnd = this.lineEnd(markerStart);
      let afterMarker = markerStart + 3;
      while (
        afterMarker < lineEnd &&
        (this.src[afterMarker] === " " || this.src[afterMarker] === "\t")
      ) {
        afterMarker += 1;
      }
      if (afterMarker < lineEnd && this.src[afterMarker] !== "#") {
        const tokenEnd = lineEnd;
        this.recordError(
          "UNEXPECTED_TOKEN",
          "Unexpected scalar at node end",
          afterMarker,
          tokenEnd,
        );
      }
      docEnd = this.afterLineBreak(lineEnd);
      this.i = docEnd;
      this.collectTrivia();
      if (this.atDocStart()) {
        this.recordError(
          "MULTIPLE_DOCS",
          "Source contains multiple documents; please use YAML.parseAllDocuments()",
          this.i,
          this.secondDocContentEnd(this.i),
        );
      }
    } else if (this.atDocStart()) {
      const marker = this.i;
      this.recordError(
        "MULTIPLE_DOCS",
        "Source contains multiple documents; please use YAML.parseAllDocuments()",
        marker,
        this.secondDocContentEnd(marker),
      );
      docEnd = hadTrailing
        ? node.kind === "scalar"
          ? trailingComments
            ? Math.max(this.pendingCommentEnd, node.range[2])
            : marker
          : marker
        : node.range[2];
    } else if (this.flowCloseEnd !== null && this.findEndMarkerAfter(node.range[2]) === null) {
      docEnd = Math.max(node.range[2], this.flowCloseEnd);
    } else if (this.explicitCommaDocEnd !== null) {
      docEnd = this.explicitCommaDocEnd;
    } else if (this.flowCommentEnd !== null) {
      docEnd = this.flowCommentEnd;
    } else if (!trailingComments && hasTrailingEmptyValue(node)) {
      docEnd = node.range[2];
    } else if (!trailingComments && this.endsWithExplicitKey(node)) {
      docEnd = node.range[2];
    } else if (this.flowRootEnd !== null) {
      docEnd = this.flowRootEnd;
    } else {
      const endMarker = this.findEndMarkerAfter(this.trailingDocEnd ?? this.i);
      if (endMarker !== null) {
        docEnd = endMarker;
      } else if (this.trailingDocEnd !== null) {
        docEnd = this.trailingDocEnd;
        if (node.kind === "scalar") {
          const tokenLineStart = this.lineStartIndex(docEnd);
          if (tokenLineStart !== docEnd && tokenLineStart > 0) {
            const prevLineEnd = tokenLineStart - 1;
            const prevLineStart = this.lineStartIndex(prevLineEnd);
            if (this.src.slice(prevLineStart, prevLineEnd).trim().startsWith("#")) {
              docEnd = tokenLineStart;
            }
          }
        }
      }
    }
    if (this.suppressTrailing) {
      const endMarker = this.findEndMarkerAfter(node.range[2]);
      docEnd = this.flowCommentEnd ?? endMarker ?? node.range[2];
    }
    const start = this.documentStartOverride ?? markerPos ?? rootStart ?? node.range[0];
    return {
      contents: node,
      errors: this.errors,
      warnings: this.warnings,
      range: [start, node.range[2], docEnd],
      schema: this.schema,
      tags: this.tags,
      version: this.version,
      explicitVersion: this.explicitVersion,
    };
  }

  private parseDirective(): void {
    const start = this.i;
    const end = this.lineEnd(start);
    const rawLine = this.src.slice(start, end);
    const content = rawLine.trim();
    const contentStart = start + (rawLine.length - rawLine.trimStart().length);
    this.i = this.afterLineBreak(end);
    const parts = content.split(/\s+/);
    if (parts[0] === "%YAML") {
      if (parts.length > 2) {
        this.recordWarning(
          "BAD_DIRECTIVE",
          "%YAML directive should contain exactly two parts",
          contentStart,
          contentStart + content.length,
        );
      }
      const raw = parts[1] ?? "1.2";
      const versionStart = content.indexOf(raw, 5);
      const versionPos = contentStart + (versionStart === -1 ? 5 : versionStart);
      this.explicitVersion = true;
      if (raw !== "1.1" && raw !== "1.2") {
        this.recordWarning(
          "BAD_DIRECTIVE",
          `Unsupported YAML version ${raw}`,
          versionPos,
          versionPos + raw.length,
        );
      }
      if (raw === "1.1") {
        this.version = "1.1";
        this.schema = "yaml-1.1";
      } else {
        this.version = "1.2";
        this.schema = "core";
      }
      return;
    }
    if (parts[0] !== "%TAG") {
      this.recordWarning(
        "BAD_DIRECTIVE",
        `Unsupported directive: ${parts[0] ?? content}`,
        contentStart,
        contentStart + content.length,
      );
      return;
    }
    if (parts.length !== 3) {
      this.recordError(
        "BAD_DIRECTIVE",
        "%TAG directive should contain exactly two parts",
        contentStart,
        contentStart + content.length,
      );
      return;
    }
    this.tags[parts[1]!] = parts[2]!;
  }

  private nextContentLine(pos: number): number | null {
    let index = this.afterLineBreak(this.lineEnd(pos));
    while (index < this.n) {
      const lineEnd = this.lineEnd(index);
      const text = this.src.slice(index, lineEnd).trim();
      if (text.length > 0 && !text.startsWith("#")) {
        let content = index;
        while (content < lineEnd && (this.src[content] === " " || this.src[content] === "\t")) {
          content += 1;
        }
        return content;
      }
      const next = this.afterLineBreak(lineEnd);
      if (next === index) {
        return null;
      }
      index = next;
    }
    return null;
  }

  private findMultilineKey(start: number): { text: string; keyEnd: number; colon: number } | null {
    const firstLineStart = this.lineStartIndex(start);
    let firstProbe = firstLineStart;
    while (firstProbe < this.n && (this.src[firstProbe] === " " || this.src[firstProbe] === "\t")) {
      firstProbe += 1;
    }
    if (start !== firstProbe) {
      return null;
    }
    let index = start;
    let text = "";
    let pendingBreaks = 0;
    let first = true;
    while (index < this.n) {
      const lineStart = this.lineStartIndex(index);
      const lineEnd = this.lineEnd(index);
      const line = this.src.slice(lineStart, lineEnd);
      const trimmed = line.trim();
      if (
        trimmed.startsWith("#") ||
        this.src.startsWith("...", lineStart) ||
        this.src.startsWith("---", lineStart)
      ) {
        return null;
      }
      if (trimmed.length === 0) {
        pendingBreaks += 1;
        index = this.afterLineBreak(lineEnd);
        continue;
      }
      let commentPos = -1;
      for (let pos = lineStart; pos < lineEnd; pos += 1) {
        if (
          this.src[pos] === "#" &&
          (pos === lineStart || this.src[pos - 1] === " " || this.src[pos - 1] === "\t")
        ) {
          commentPos = pos;
          break;
        }
      }
      const effectiveEnd = commentPos === -1 ? lineEnd : commentPos;
      let colon = -1;
      let depth = 0;
      let quote = "";
      for (let pos = lineStart; pos < effectiveEnd; pos += 1) {
        const ch = this.src[pos];
        if (quote !== "") {
          if (quote === '"' && ch === "\\") {
            pos += 1;
            continue;
          }
          if (ch === quote) {
            quote = "";
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          continue;
        }
        if (ch === "[" || ch === "{") {
          depth += 1;
          continue;
        }
        if (ch === "]" || ch === "}") {
          depth -= 1;
          continue;
        }
        if (ch === ":" && (pos + 1 >= this.n || this.isSep(pos + 1))) {
          colon = pos;
          break;
        }
      }
      if (colon === -1 && commentPos !== -1) {
        return null;
      }
      if (colon !== -1) {
        if (first) {
          return null;
        }
        const piece = this.src.slice(lineStart, colon).trim();
        if (piece.length > 0) {
          if (text.length > 0) {
            text += pendingBreaks > 0 ? "\n".repeat(pendingBreaks) : " ";
          }
          text += piece;
        }
        return { text, keyEnd: colon, colon };
      }
      if (lineStart !== start) {
        if (text.length > 0) {
          text += pendingBreaks > 0 ? "\n".repeat(pendingBreaks) : " ";
        }
      } else {
        text += "";
      }
      text += this.src.slice(lineStart, effectiveEnd).trim();
      first = false;
      pendingBreaks = 0;
      const next = this.afterLineBreak(lineEnd);
      if (next === index) {
        return null;
      }
      index = next;
    }
    return null;
  }

  private parseBlockNode(
    parentIndent: number,
    value: boolean,
    keyContext = false,
  ): ParseNode | null {
    if (this.i >= this.n) {
      return null;
    }
    const col = this.column();
    if (col < parentIndent) {
      return null;
    }
    if (this.atDocMarker()) {
      return null;
    }
    const ch = this.src[this.i];
    if (this.flowDepth === 0 && (ch === "]" || ch === "}")) {
      const empty = this.makeEmptyScalar(this.i);
      Object.defineProperty(empty, "flowCloseAt", { value: this.i, enumerable: false });
      return empty;
    }
    const isBlockSeq = ch === "-" && this.isSep(this.i + 1);
    const isBlockMap =
      !isBlockSeq && ((ch === "?" && this.isSep(this.i + 1)) || this.lineHasMapping());
    if (
      keyContext &&
      !isBlockSeq &&
      !isBlockMap &&
      ch !== "[" &&
      ch !== "{" &&
      ch !== '"' &&
      ch !== "'" &&
      ch !== "*" &&
      ch !== "&" &&
      ch !== "!" &&
      ch !== "|" &&
      ch !== ">"
    ) {
      const multi = this.findMultilineKey(this.i);
      if (multi !== null) {
        const trivia = this.takeTriviaForNode();
        const key = makeScalar(multi.text);
        key.source = multi.text;
        key.range = [this.i, multi.keyEnd, multi.keyEnd];
        if (!value) {
          attachBefore(key, trivia);
        }
        this.recordError(
          "MULTILINE_IMPLICIT_KEY",
          "Implicit keys need to be on a single line",
          key.range[0],
          key.range[1],
        );
        this.reportBadScalarStart(key.range[0]);
        this.i = multi.colon + 1;
        const colonIndent = this.lineIndentOf(key.range[0]);
        const firstValue = this.parseIndicatorValue(colonIndent, false);
        const map = makeMap();
        if (value) {
          attachBefore(map, trivia);
        }
        map.items.push(makePair(key, firstValue));
        map.range = [key.range[0], firstValue.range[2], firstValue.range[2]];
        if (this.i < this.n && !this.atDocMarker()) {
          const rest = this.parseBlockMap(this.lineIndentOf(key.range[0]));
          if (rest.items.length > 0) {
            const chainHead = firstValue;
            if (
              chainHead.kind === "map" &&
              chainHead.items.length === 1 &&
              chainHead.items[0]?.key?.kind === "scalar" &&
              chainHead.items[0].key.source.includes(", ")
            ) {
              this.appendToChainMap(chainHead, rest);
            } else {
              map.items.push(...rest.items);
            }
            map.range[2] = rest.range[2];
            map.range[1] = rest.range[1];
          }
        }
        return map;
      }
      const nextContent = this.nextContentLine(this.i);
      if (
        nextContent !== null &&
        this.lineIndentOf(nextContent) > this.lineIndentOf(this.i) &&
        (this.src[nextContent] === "[" ||
          this.src[nextContent] === "{" ||
          this.lineHasMappingAt(nextContent))
      ) {
        this.recordSoftError(
          "MULTILINE_IMPLICIT_KEY",
          "Implicit keys need to be on a single line",
          this.i,
          this.i + 1,
        );
      }
    }
    let trivia: Trivia | null = null;
    if (value || (!isBlockSeq && !isBlockMap)) {
      trivia = this.takeTriviaForNode();
    }
    let node: ParseNode;
    if (isBlockSeq) {
      node = this.parseBlockSeq(col);
    } else if (isBlockMap) {
      node = this.parseBlockMap(col);
    } else {
      node = this.parseInlineNode(false);
    }
    if (trivia) {
      attachBefore(node, trivia);
    }
    return node;
  }

  private parseBlockSeq(indent: number): ParseSeqNode {
    const depth = this.blockCollectionDepth;
    this.blockCollectionDepth = depth + 1;
    const seq = makeSeq();
    const start = this.i;
    let lastEnd = start;
    let previous: ParseNode | null = null;
    while (this.i < this.n) {
      this.tick();
      if (previous !== null) {
        this.attachContinuationComments(previous, indent);
        lastEnd = Math.max(lastEnd, previous.range[2]);
      }
      this.collectTrivia();
      if (this.i >= this.n) {
        break;
      }
      if (depth > 0) {
        const seqLineStart = this.lineStartIndex(this.i);
        let seqTab = -1;
        for (let probe = seqLineStart; probe < this.i; probe += 1) {
          if (this.src[probe] === "\t") {
            seqTab = probe;
            break;
          }
        }
        const seqIndicator = this.src[this.i];
        if (
          seqTab !== -1 &&
          (seqIndicator === ":" || seqIndicator === "-" || seqIndicator === "?") &&
          (this.i + 1 >= this.n || this.isSep(this.i + 1))
        ) {
          this.recordError(
            "TAB_AS_INDENT",
            "Tabs are not allowed as indentation",
            seqTab,
            seqTab + 1,
          );
        }
      }
      if (this.column() !== indent) {
        break;
      }
      if (this.src[this.i] !== "-" || !this.isSep(this.i + 1)) {
        break;
      }
      this.i += 1;
      this.seqFirstItem = seq.items.length === 0;
      const item = this.parseIndicatorValue(indent, true);
      seq.items.push(item);
      previous = item;
      lastEnd = item.range[2];
    }
    let nodeEnd = lastEnd;
    if (
      depth > 0 &&
      this.pendingComments.length > 0 &&
      this.i < this.n &&
      !this.atDocMarker() &&
      this.pendingCommentIndent >= indent
    ) {
      const text = this.pendingComments.join("\n");
      if (text.length > 0) {
        appendComment(seq, text);
      }
      nodeEnd = Math.max(nodeEnd, this.i);
      this.pendingComments = [];
      this.pendingBlank = false;
      this.pendingBlankBefore = false;
      this.pendingCommentEnd = 0;
      this.pendingCommentLineEnd = 0;
      this.pendingCommentIndent = -1;
    }
    seq.range = [start, lastEnd, nodeEnd];
    return seq;
  }

  private parseBlockMap(indent: number, keepTrailingComments = false): ParseMapNode {
    const depth = this.blockCollectionDepth;
    this.blockCollectionDepth = depth + 1;
    const map = makeMap();
    const explicitFirst = this.src[this.i] === "?" && this.isSep(this.i + 1);
    let start = explicitFirst ? this.i : this.i;
    let firstPair = true;
    let lastEnd = start;
    let badRecovered = false;
    let unwrappedKeyMap = false;
    let previous: ParseNode | null = null;
    while (this.i < this.n) {
      this.tick();
      if (previous !== null) {
        this.attachContinuationComments(previous, indent);
        lastEnd = Math.max(lastEnd, previous.range[2]);
      }
      this.collectTrivia();
      if (this.i >= this.n) {
        break;
      }
      if (depth > 0 && this.i < this.n) {
        const collectionLineStart = this.lineStartIndex(this.i);
        let collectionTab = -1;
        for (let probe = collectionLineStart; probe < this.i; probe += 1) {
          if (this.src[probe] === "\t") {
            collectionTab = probe;
            break;
          }
        }
        const collectionIndicator = this.src[this.i];
        const collectionIsIndicator =
          (collectionIndicator === ":" ||
            collectionIndicator === "-" ||
            collectionIndicator === "?") &&
          (this.i + 1 >= this.n || this.isSep(this.i + 1));
        if (collectionTab !== -1 && collectionIsIndicator) {
          this.recordError(
            "TAB_AS_INDENT",
            "Tabs are not allowed as indentation",
            collectionTab,
            collectionTab + 1,
          );
        } else if (
          collectionTab === -1 &&
          previous === null &&
          collectionIndicator === "?" &&
          (this.i + 1 >= this.n || this.isSep(this.i + 1)) &&
          !(() => {
            const lineEnd = this.lineEnd(this.i);
            for (let probe = this.i + 1; probe < lineEnd; probe += 1) {
              if (
                this.src[probe] === ":" &&
                (probe + 1 >= lineEnd ||
                  this.src[probe + 1] === " " ||
                  this.src[probe + 1] === "\t")
              ) {
                return true;
              }
            }
            return false;
          })()
        ) {
          const currentLineEnd = this.lineEnd(this.i);
          const nextLine = this.afterLineBreak(currentLineEnd);
          if (nextLine < this.n) {
            let nextContent = nextLine;
            while (
              nextContent < this.n &&
              (this.src[nextContent] === " " || this.src[nextContent] === "\t")
            ) {
              nextContent += 1;
            }
            if (
              nextContent < this.n &&
              !this.isLineBreak(nextContent) &&
              this.src[nextContent] !== ":"
            ) {
              const nextIndent = nextContent - nextLine;
              const currentIndent = this.i - collectionLineStart;
              if (nextIndent === currentIndent) {
                this.recordError(
                  "MISSING_CHAR",
                  "Sequence item without - indicator",
                  collectionLineStart,
                  collectionLineStart + 1,
                );
              } else if (nextIndent < currentIndent) {
                this.recordError(
                  "BAD_INDENT",
                  "All sequence items must start at the same column",
                  collectionLineStart,
                  collectionLineStart + 1,
                );
              }
            }
          }
        }
      }
      if (previous?.kind === "scalar" && previous.source === "" && previous.comment !== undefined) {
        const currentLineStart = this.lineStartIndex(this.i);
        let tabPos = -1;
        for (let probe = currentLineStart; probe < this.i; probe += 1) {
          if (this.src[probe] === "\t") {
            tabPos = probe;
            break;
          }
        }
        const indicator = this.src[this.i];
        const isIndicator =
          (indicator === ":" || indicator === "-" || indicator === "?") &&
          (this.i + 1 >= this.n || this.isSep(this.i + 1));
        if (tabPos !== -1 && isIndicator) {
          this.recordError(
            "TAB_AS_INDENT",
            "Tabs are not allowed as indentation",
            tabPos,
            tabPos + 1,
          );
        } else if (tabPos === -1 && indicator === "?") {
          this.recordError(
            "MISSING_CHAR",
            "Sequence item without - indicator",
            currentLineStart,
            currentLineStart + 1,
          );
        }
      }
      const inlineColon =
        this.src[this.i] === ":" &&
        this.isSep(this.i + 1) &&
        this.i !== this.lineStartIndex(this.i) + this.lineIndentOf(this.i);
      let emptyKeyProbe = this.lineStartIndex(this.i);
      while (
        emptyKeyProbe < this.n &&
        (this.src[emptyKeyProbe] === " " || this.src[emptyKeyProbe] === "\t")
      ) {
        emptyKeyProbe += 1;
      }
      const emptyKeyLine =
        this.src[this.i] === ":" &&
        this.isSep(this.i + 1) &&
        this.column() > indent &&
        emptyKeyProbe === this.i;
      if (this.column() !== indent && !inlineColon && !emptyKeyLine) {
        break;
      }
      if (emptyKeyLine) {
        const lineStart = this.lineStartIndex(this.i);
        const key = this.makeEmptyScalar(lineStart);
        this.i += 1;
        let inlineProbe = this.i;
        while (
          inlineProbe < this.n &&
          (this.src[inlineProbe] === " " || this.src[inlineProbe] === "\t")
        ) {
          inlineProbe += 1;
        }
        const hasInlineValue =
          inlineProbe < this.n && !this.isLineBreak(inlineProbe) && this.src[inlineProbe] !== "#";
        const value = this.parseIndicatorValue(indent, false);
        if (
          (!hasInlineValue || (previous?.kind === "scalar" && previous.comment !== undefined)) &&
          value.kind === "scalar" &&
          value.type === "PLAIN" &&
          this.src.slice(value.range[0], value.range[1]).includes("\n") &&
          (() => {
            const firstLineEnd = this.src.indexOf("\n", value.range[0]);
            const firstLine = this.src
              .slice(value.range[0], firstLineEnd === -1 ? value.range[1] : firstLineEnd)
              .trim();
            return firstLine.length === 1;
          })()
        ) {
          const newline = this.src.indexOf("\n", value.range[0]);
          const continuation = newline === -1 ? value.range[0] : newline + 1;
          this.recordError(
            "BAD_INDENT",
            "All mapping items must start at the same column",
            continuation,
            continuation + 1,
          );
        }
        const pair = makePair(key, value);
        map.items.push(pair);
        previous = value;
        lastEnd = value.range[2];
        continue;
      }
      if (this.atDocMarker()) {
        break;
      }
      if (this.src[this.i] === "-" && this.isSep(this.i + 1)) {
        const lastError = this.errors[this.errors.length - 1];
        if (
          badRecovered ||
          (lastError?.code === "BAD_INDENT" &&
            lastError.message.startsWith("Flow sequence in block collection") &&
            lastError.pos[0] === this.i &&
            previous?.kind === "seq" &&
            previous.range[2] === this.i)
        ) {
          if (!badRecovered) {
            const pos = this.i;
            const emptyKey = this.makeEmptyScalar(pos);
            map.items.push(makePair(emptyKey, null));
            this.recordError(
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys need to be on a single line",
              pos,
              pos + 1,
            );
            this.recordError(
              "UNEXPECTED_TOKEN",
              "Unexpected block-seq-ind on same line with key",
              pos,
              pos + 1,
            );
            this.recordError(
              "MISSING_CHAR",
              "Implicit map keys need to be followed by map values",
              pos,
              pos,
            );
            const dashLineEnd = this.lineEnd(pos);
            let dashProbe = pos + 1;
            while (
              dashProbe < dashLineEnd &&
              (this.src[dashProbe] === " " || this.src[dashProbe] === "\t")
            ) {
              dashProbe += 1;
            }
            if (dashProbe < dashLineEnd && this.src[dashProbe] === "#") {
              emptyKey.comment = normalizeComment(this.src.slice(dashProbe + 1, dashLineEnd));
              lastEnd = this.nextContentLine(pos) ?? dashLineEnd;
              let commentProbe = this.afterLineBreak(dashLineEnd);
              while (commentProbe < this.n) {
                const commentLineEnd = this.lineEnd(commentProbe);
                const text = this.src.slice(commentProbe, commentLineEnd).trim();
                if (text.startsWith("#")) {
                  this.flowCommentEnd = commentProbe;
                  break;
                }
                commentProbe = this.afterLineBreak(commentLineEnd);
              }
            } else {
              lastEnd = pos + 2;
            }
            previous = emptyKey;
          }
          this.suppressTrailing = true;
        }
        break;
      }
      const pairStart = this.i;
      const pair = this.parsePair(indent);
      if (firstPair) {
        firstPair = false;
        if (!explicitFirst && pair.key !== null) {
          start = pair.key.range[0];
        }
      }
      if (
        (pair as unknown as { unwrapKeyMap?: boolean }).unwrapKeyMap === true &&
        pair.key?.kind === "map"
      ) {
        map.items.push(...pair.key.items);
        const tail = pair.key.items[pair.key.items.length - 1] ?? null;
        previous = tail ? (tail.value ?? tail.key) : null;
        lastEnd = pair.key.range[1];
        unwrappedKeyMap = true;
        continue;
      }
      this.checkDuplicateKey(map, pair.key);
      map.items.push(pair);
      previous = pair.value ?? pair.key;
      const badInfo =
        pair.value?.kind === "scalar"
          ? (
              pair.value as unknown as {
                badBlockIndent?: { lineStart: number; contentStart: number; contentEnd: number };
              }
            ).badBlockIndent
          : undefined;
      if (badInfo !== undefined) {
        badRecovered = true;
        const source = this.src.slice(badInfo.contentStart, badInfo.contentEnd).trim();
        const badKey = makeScalar(source);
        badKey.source = source;
        badKey.range = [badInfo.contentStart, badInfo.contentEnd, badInfo.contentEnd];
        this.recordError(
          "MISSING_CHAR",
          "Implicit map keys need to be followed by map values",
          badInfo.contentStart,
          badInfo.contentEnd,
        );
        this.i = this.afterLineBreak(badInfo.contentEnd);
        if (this.i < this.n && this.src[this.i] === "#") {
          const commentEnd = this.lineEnd(this.i);
          badKey.comment = normalizeComment(this.src.slice(this.i + 1, commentEnd));
          this.i = this.afterLineBreak(commentEnd);
          this.pendingBlank = true;
          this.pendingBlankBefore = true;
        }
        map.items.push(makePair(badKey, null));
        previous = badKey;
        lastEnd = this.i;
        continue;
      }
      if (pair.value !== null) {
        lastEnd = pair.value.range[2];
      } else if ((pair as unknown as { commaKeyEnd?: number }).commaKeyEnd !== undefined) {
        lastEnd = (pair as unknown as { commaKeyEnd?: number }).commaKeyEnd!;
      } else if (pair.key?.kind === "scalar" && pair.key.source === "") {
        lastEnd = pair.key.range[2];
      } else if (
        (pair as unknown as { explicit?: boolean }).explicit === true &&
        pair.key !== null &&
        !(pair.key.kind === "scalar" && pair.key.source !== "")
      ) {
        lastEnd = pair.key.range[2];
      } else {
        lastEnd = this.i;
        if (lastEnd < this.n && this.isLineBreak(lastEnd)) {
          lastEnd = this.afterLineBreak(lastEnd);
        }
      }
      if (lastEnd < pairStart) {
        lastEnd = pairStart;
      }
    }
    let nodeEnd = lastEnd;
    if (unwrappedKeyMap && nodeEnd < this.n && this.isLineBreak(nodeEnd)) {
      nodeEnd = this.afterLineBreak(nodeEnd);
    }
    if (
      !keepTrailingComments &&
      depth > 0 &&
      this.pendingComments.length > 0 &&
      this.pendingCommentIndent >= indent
    ) {
      const text = this.pendingComments.join("\n");
      if (text.length > 0) {
        appendComment(map, text);
      }
      nodeEnd = Math.max(nodeEnd, this.i);
      this.pendingComments = [];
      this.pendingBlank = false;
      this.pendingBlankBefore = false;
      this.pendingCommentEnd = 0;
      this.pendingCommentLineEnd = 0;
      this.pendingCommentIndent = -1;
    }
    if (depth === 0 && this.pendingComments.length > 0 && map.items.length > 0) {
      const chain: ParseMapNode[] = [map];
      let target = map;
      while (target.items.length > 0) {
        const tail = target.items[target.items.length - 1];
        if (tail?.value !== null && tail?.value?.kind === "map") {
          target = tail.value;
          chain.push(target);
          continue;
        }
        break;
      }
      const lastPair = target.items[target.items.length - 1];
      if (
        lastPair?.value === null &&
        lastPair.key !== null &&
        !(lastPair.key.kind === "scalar" && lastPair.key.source === "")
      ) {
        const text = this.pendingComments.join("\n");
        lastPair.key.comment = lastPair.key.comment ? `${lastPair.key.comment}\n${text}` : text;
        const commentEnd = this.pendingCommentEnd;
        for (const link of chain) {
          link.range[1] = Math.max(link.range[1], commentEnd);
          link.range[2] = Math.max(link.range[2], commentEnd);
        }
        nodeEnd = Math.max(nodeEnd, commentEnd);
        lastEnd = Math.max(lastEnd, nodeEnd);
        this.pendingComments = [];
        this.pendingBlank = false;
        this.pendingBlankBefore = false;
        this.pendingCommentEnd = 0;
        this.pendingCommentLineEnd = 0;
        this.pendingCommentIndent = -1;
      }
    }
    this.blockCollectionDepth = depth;
    map.range = [start, lastEnd, nodeEnd];
    return map;
  }

  private parsePair(indent: number): ParsePairNode {
    if (this.src[this.i] === "?" && this.isSep(this.i + 1)) {
      const pair = this.parseExplicitPair(indent);
      Object.defineProperty(pair, "explicit", { value: true, enumerable: false });
      return pair;
    }
    const keyTrivia = this.takeTriviaForNode();
    const ch0 = this.i < this.n ? this.src[this.i] : "";
    if (
      !this.lineHasMapping() &&
      ch0 !== "" &&
      ch0 !== "[" &&
      ch0 !== "{" &&
      ch0 !== '"' &&
      ch0 !== "'" &&
      ch0 !== "-" &&
      ch0 !== "?" &&
      ch0 !== "*" &&
      ch0 !== "&" &&
      ch0 !== "!"
    ) {
      const multi = this.findMultilineKey(this.i);
      if (multi !== null) {
        const keyNode = makeScalar(multi.text);
        keyNode.source = multi.text;
        keyNode.range = [this.i, multi.keyEnd, multi.keyEnd];
        attachBefore(keyNode, keyTrivia);
        this.recordError(
          "MULTILINE_IMPLICIT_KEY",
          "Implicit keys need to be on a single line",
          keyNode.range[0],
          keyNode.range[1],
        );
        this.reportBadScalarStart(keyNode.range[0]);
        this.i = multi.colon + 1;
        const value = this.parseIndicatorValue(indent, false);
        return makePair(keyNode, value);
      }
    }
    const errorsBeforeKey = this.errors.length;
    const key = this.parseKeyNode();
    attachBefore(key, keyTrivia);
    this.skipInlineSpaces();
    if (this.i < this.n && this.src[this.i] === ":") {
      this.i += 1;
      const value = this.parseIndicatorValue(indent, false);
      return makePair(key, value);
    }
    if (key.kind !== "scalar" && key.kind !== "alias" && this.errors.length > errorsBeforeKey) {
      const pair = makePair(key, null);
      Object.defineProperty(pair, "unwrapKeyMap", { value: true, enumerable: false });
      return pair;
    }
    this.recordError(
      "MISSING_CHAR",
      "Implicit map keys need to be followed by map values",
      key.range[0],
      key.range[1],
    );
    return makePair(key, null);
  }

  private parseExplicitPair(indent: number): ParsePairNode {
    this.i += 1;
    this.skipInlineSpaces();
    let markerComment: Trivia | null = null;
    if (this.i < this.n && this.src[this.i] === "#") {
      markerComment = this.readSameLineComment();
      this.pendingComments = [...markerComment.comments];
    }
    let key: ParseNode;
    const keyTrivia = this.takeTriviaForNode();
    if (markerComment) {
      this.collectTrivia();
      if (this.i < this.n && !this.atDocMarker() && this.lineIndent() > indent) {
        key = this.parseBlockNode(indent + 1, true) ?? makeScalar(null);
      } else {
        key = this.makeEmptyScalar(this.i);
      }
    } else if (this.i >= this.n || this.isLineBreak(this.i) || this.atDocMarker()) {
      const emptyPos = this.i;
      this.collectTrivia();
      if (this.i < this.n && this.column() > indent) {
        key = this.parseBlockNode(indent + 1, true) ?? makeScalar(null);
      } else {
        key = this.makeEmptyScalar(emptyPos);
        key.spaceBefore = true;
      }
    } else if (this.src[this.i] === "-" && this.isSep(this.i + 1)) {
      key = this.parseBlockSeq(this.column());
    } else {
      key = this.parseInlineNode(true);
    }
    if (key.kind === "scalar" || key.kind === "alias") {
      key.range[2] = key.range[1];
    }
    let explicitTriviaUsed = false;
    if (
      this.i < this.n &&
      this.src[this.i] === ":" &&
      this.lineStartIndex(this.i) === this.lineStartIndex(Math.max(key.range[0], key.range[1] - 1))
    ) {
      const colonPos = this.i;
      this.i += 1;
      const innerEmptyPos = this.skipInlineSpaces();
      let innerValue: ParseNode;
      if (this.i < this.n && !this.isLineBreak(this.i) && !this.atDocMarker()) {
        innerValue = this.parseIndicatorValue(indent, false);
      } else {
        innerValue = this.makeEmptyScalar(innerEmptyPos);
      }
      const inner = makeMap();
      inner.items.push(makePair(key, innerValue));
      const innerIndent = this.lineIndent();
      const innerEnd =
        innerIndent > 0 ? Math.max(innerValue.range[2], this.i + innerIndent) : innerValue.range[2];
      inner.range = [colonPos, innerValue.range[2], innerEnd];
      attachBefore(inner, keyTrivia);
      key = inner;
      explicitTriviaUsed = true;
    }
    if (!explicitTriviaUsed) {
      attachBefore(key, keyTrivia);
    }
    this.skipInlineSpaces();
    if (this.i < this.n && this.src[this.i] === ",") {
      let probe = this.i + 1;
      while (probe < this.n && (this.src[probe] === " " || this.src[probe] === "\t")) {
        probe += 1;
      }
      if (probe >= this.n || this.isLineBreak(probe) || this.src[probe] === "#") {
        const keyEnd = key.range[2];
        this.i = probe;
        if (probe < this.n && this.src[probe] === "#") {
          const commentEnd = this.lineEnd(probe);
          this.i = this.afterLineBreak(commentEnd);
        }
        let scan = this.i;
        let hasNext = false;
        while (scan < this.n) {
          let char = scan;
          while (char < this.n && (this.src[char] === " " || this.src[char] === "\t")) {
            char += 1;
          }
          if (char >= this.n) {
            break;
          }
          if (this.isLineBreak(char)) {
            scan = this.afterLineBreak(char);
            continue;
          }
          if (this.src[char] === "#") {
            scan = this.afterLineBreak(this.lineEnd(char));
            continue;
          }
          hasNext = true;
          break;
        }
        if (!hasNext) {
          this.explicitCommaDocEnd = keyEnd;
        }
        const pair = makePair(key, null);
        Object.defineProperty(pair, "commaKeyEnd", { value: keyEnd, enumerable: false });
        return pair;
      }
    }
    if (this.i < this.n && this.src[this.i] === "#") {
      if (
        this.i === key.range[1] &&
        key.kind === "scalar" &&
        (key.type === "QUOTE_DOUBLE" || key.type === "QUOTE_SINGLE")
      ) {
        this.recordError(
          "MISSING_CHAR",
          "Comments must be separated from other tokens by white space characters",
          this.i,
          this.lineEnd(this.i),
        );
      }
      const end = this.lineEnd(this.i);
      appendComment(key, normalizeComment(this.src.slice(this.i + 1, end)));
      this.i = this.afterLineBreak(end);
    }
    this.skipInlineSpaces();
    if (
      this.i < this.n &&
      this.src[this.i] === ":" &&
      this.lineStartIndex(this.i) === this.lineStartIndex(Math.max(key.range[0], key.range[1] - 1))
    ) {
      this.i += 1;
      const value = this.parseIndicatorValue(indent, false);
      return makePair(key, value);
    }
    this.collectTrivia();
    if (this.i < this.n && this.column() === indent && this.src[this.i] === ":") {
      this.i += 1;
      const value = this.parseIndicatorValue(indent, false);
      return makePair(key, value);
    }
    return makePair(key, null);
  }

  private parseKeyNode(): ParseNode {
    const props = this.parseProperties();
    const ch = this.i < this.n ? this.src[this.i] : "";
    if (ch === "?" && this.isSep(this.i + 1)) {
      const node = this.parseBlockMap(this.column());
      this.applyProperties(node, props);
      return node;
    }
    let node: ParseNode;
    if (ch === "*") {
      node = this.parseAlias();
    } else if (ch === "[") {
      node = this.parseFlowSeq();
    } else if (ch === "{") {
      node = this.parseFlowMap();
    } else if (ch === '"') {
      node = this.parseDoubleQuoted();
    } else if (ch === "'") {
      node = this.parseSingleQuoted();
    } else {
      node = this.parsePlain(true, this.plainIndent ?? this.lineIndent());
    }
    this.applyProperties(node, props);
    this.finishKey(node);
    return node;
  }

  private parseIndicatorValue(indent: number, seqItem: boolean): ParseNode {
    const preComments = this.pendingComments;
    const preBlank = this.pendingBlankBefore;
    const preCommentEnd = this.pendingCommentEnd;
    this.pendingComments = [];
    this.pendingBlank = false;
    this.pendingBlankBefore = false;
    this.pendingCommentEnd = 0;
    this.pendingCommentLineEnd = 0;
    this.pendingCommentIndent = -1;
    this.plainIndent = indent;
    this.plainContext = seqItem ? "seq" : "map";
    const spacesStart = this.i;
    const emptyPos = this.skipInlineSpaces();
    if (this.i < this.n) {
      const skipped = this.src.slice(spacesStart, this.i);
      const tabOffset = skipped.indexOf("\t");
      const nextCh = this.src[this.i];
      if (tabOffset !== -1 && (nextCh === "-" || nextCh === "?") && this.isSep(this.i + 1)) {
        const tabPos = spacesStart + tabOffset;
        this.recordError(
          "TAB_AS_INDENT",
          "Tabs are not allowed as indentation",
          tabPos,
          tabPos + 1,
        );
      }
    }
    const propStart = this.i;
    if (propStart < this.n && (this.src[propStart] === "&" || this.src[propStart] === "!")) {
      const props = this.parseProperties();
      const propEnd = this.i;
      this.skipInlineSpaces();
      if (this.i >= this.n || this.isLineBreak(this.i) || this.src[this.i] === "#") {
        this.collectTrivia();
        const nextCol = this.i < this.n ? this.lineIndent() : -1;
        if (nextCol > indent && this.i < this.n && !this.atDocMarker()) {
          const node = this.parseBlockNode(indent + 1, true);
          if (node) {
            this.applyProperties(node, props);
            return node;
          }
        }
        const empty = makeScalar(null);
        empty.source = "";
        empty.range = [propEnd, propEnd, propEnd];
        this.applyProperties(empty, props);
        this.pendingComments = [];
        this.pendingBlank = false;
        this.pendingBlankBefore = false;
        this.pendingCommentEnd = 0;
        this.pendingCommentLineEnd = 0;
        this.pendingCommentIndent = -1;
        return empty;
      }
      this.i = propStart;
    }
    let markerComment: Trivia | null = null;
    if (this.i < this.n && this.src[this.i] === "#") {
      markerComment = this.readSameLineComment();
      this.pendingComments = [...markerComment.comments];
    }
    if (!markerComment && this.i < this.n && !this.isLineBreak(this.i)) {
      this.pendingComments = preComments;
      this.pendingBlank = preBlank;
      this.pendingBlankBefore = preBlank;
      this.pendingCommentEnd = preCommentEnd;
      const ch = this.src[this.i];
      if (!seqItem && this.flowDepth === 0 && ch === "-" && this.isSep(this.i + 1)) {
        this.recordError(
          "UNEXPECTED_TOKEN",
          "Unexpected block-seq-ind on same line with key",
          this.i,
          this.i + 1,
        );
      }
      if (!seqItem && this.flowDepth === 0 && ch === "?" && this.isSep(this.i + 1)) {
        this.recordError(
          "BLOCK_AS_IMPLICIT_KEY",
          "Nested mappings are not allowed in compact mappings",
          this.i,
          this.i + 1,
        );
      }
      if (this.flowDepth === 0 && (ch === "]" || ch === "}")) {
        const empty = this.makeEmptyScalar(emptyPos);
        if (preComments.length > 0) {
          if (this.seqFirstItem) {
            empty.commentBefore = preComments.join("\n");
          } else {
            empty.comment = preComments.join("\n");
          }
        }
        return empty;
      }
      if (!seqItem && ch !== "[" && ch !== "{" && this.lineHasMapping()) {
        this.recordError(
          "BLOCK_AS_IMPLICIT_KEY",
          "Nested mappings are not allowed in compact mappings",
          this.i,
          this.i + 1,
        );
      }
      if (!seqItem && (ch === "[" || ch === "{")) {
        const trivia = this.takeTriviaForNode();
        const inline = this.parseInlineNode(false);
        attachBefore(inline, trivia);
        return inline;
      }
      const node = this.parseBlockNode(indent + 1, true);
      return this.maybeComposeNestedMap(node) ?? this.makeEmptyScalar(emptyPos);
    }
    if (!markerComment && this.i < this.n && this.isLineBreak(this.i)) {
      this.i = this.consumeLineBreak();
    }
    this.collectTrivia();
    const postComments = this.pendingComments;
    const postBlank = Boolean(this.pendingBlankBefore);
    const postCommentEnd = this.pendingCommentEnd;
    const postCommentLineEnd = this.pendingCommentLineEnd;
    const postCommentIndent = this.pendingCommentIndent;
    const mergedComments = [...preComments, ...postComments];
    const mergedBlank = preBlank || postBlank;
    const mergedEnd = Math.max(
      preCommentEnd,
      markerComment ? markerComment.end : 0,
      postCommentEnd,
    );
    if (this.i < this.n && !this.atDocMarker()) {
      const nextCol = this.lineIndent();
      const indentlessSeq =
        seqItem === false &&
        this.src[this.i] === "-" &&
        this.isSep(this.i + 1) &&
        nextCol === indent;
      if (nextCol > indent || indentlessSeq) {
        this.pendingComments = mergedComments;
        this.pendingBlank = mergedBlank;
        this.pendingBlankBefore = mergedBlank;
        this.pendingCommentEnd = mergedEnd;
        this.pendingCommentIndent = postCommentIndent;
        const node = this.parseBlockNode(indentlessSeq ? indent : indent + 1, true);
        if (node) {
          const flowCloseAt = (node as unknown as { flowCloseAt?: number }).flowCloseAt;
          if (flowCloseAt !== undefined) {
            node.range = [emptyPos, emptyPos, markerComment ? flowCloseAt : emptyPos];
            if (markerComment && node.comment === undefined) {
              node.comment = markerComment.comments.join("\n");
            }
          }
          const composed = this.maybeComposeNestedMap(node) ?? node;
          if (markerComment && seqItem && composed !== node && composed.kind === "map") {
            composed.commentBefore = markerComment.comments.join("\n");
          }
          return composed;
        }
      }
    }
    const node = makeScalar(null);
    node.range = [emptyPos, emptyPos, emptyPos];
    let keepBlank = this.pendingBlank;
    let deferred = false;
    if (markerComment) {
      const allComments = [...preComments, ...postComments];
      const text = allComments.join("\n");
      if (text.length > 0) {
        node.comment = text;
      }
      node.range = [emptyPos, emptyPos, this.i];
      keepBlank = false;
    } else {
      attachBefore(node, { comments: preComments, blank: preBlank, end: preCommentEnd });
      const hasNext = this.i < this.n && !this.atDocMarker();
      const nextCol = hasNext ? this.lineIndent() : -1;
      if (postComments.length > 0 && postBlank && hasNext && nextCol >= indent) {
        deferred = true;
        keepBlank = true;
      } else if (postComments.length > 0) {
        const trimmed = [...postComments];
        while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
          trimmed.pop();
        }
        const text = trimmed.join("\n");
        if (text.length > 0) {
          appendComment(node, text);
        }
        let commentEnd: number;
        if (seqItem || nextCol < indent) {
          commentEnd = this.i;
        } else if (this.i >= this.n) {
          commentEnd = postCommentEnd;
        } else {
          commentEnd = postCommentLineEnd;
        }
        node.range[2] = Math.max(node.range[2], commentEnd);
        if (!seqItem) {
          keepBlank = true;
        }
      }
    }
    if (mergedBlank) {
      const atEnd = this.i >= this.n;
      const nextCol = atEnd ? -1 : this.lineIndent();
      if (atEnd || nextCol < indent) {
        node.spaceBefore = true;
        keepBlank = false;
      }
    }
    if (deferred) {
      this.pendingComments = postComments;
      this.pendingCommentEnd = postCommentEnd;
      this.pendingCommentLineEnd = postCommentLineEnd;
    } else {
      this.pendingComments = [];
      this.pendingCommentEnd = 0;
      this.pendingCommentLineEnd = 0;
      this.pendingCommentIndent = -1;
    }
    this.pendingBlank = keepBlank;
    this.pendingBlankBefore = keepBlank;
    return node;
  }

  private appendToChainMap(node: ParseMapNode, rest: ParseMapNode): void {
    const only: ParsePairNode | null = node.items.length === 1 ? (node.items[0] ?? null) : null;
    if (
      only?.value?.kind === "map" &&
      only.key?.kind === "scalar" &&
      only.key.source.includes(", ")
    ) {
      this.appendToChainMap(only.value, rest);
    } else {
      node.items.push(...rest.items);
    }
    node.range[1] = rest.range[2];
    node.range[2] = rest.range[2];
  }

  private findMapEndingAt(
    node: ParseNode | null,
    pos: number,
    path: ParseNode[],
  ): ParseMapNode | null {
    if (node === null) {
      return null;
    }
    if (node.kind === "seq") {
      for (let index = node.items.length - 1; index >= 0; index -= 1) {
        const item = node.items[index];
        if (item !== undefined && item.range[2] >= pos) {
          path.push(node);
          const found = this.findMapEndingAt(item, pos, path);
          if (found !== null) {
            return found;
          }
          path.pop();
        }
      }
      return null;
    }
    if (node.kind !== "map") {
      return null;
    }
    path.push(node);
    for (let index = node.items.length - 1; index >= 0; index -= 1) {
      const pair = node.items[index];
      const value = pair?.value ?? null;
      if (value !== null && value.range[2] >= pos) {
        const found = this.findMapEndingAt(value, pos, path);
        if (found !== null) {
          return found;
        }
      }
    }
    if (node.range[2] <= pos) {
      return node;
    }
    path.pop();
    return null;
  }

  private applyCommaRecovery(node: ParseNode): void {
    const recovery = this.commaRecovery;
    if (recovery === null) {
      return;
    }
    this.commaRecovery = null;
    const path: ParseNode[] = [];
    const target = this.findMapEndingAt(node, recovery.commaStart, path);
    if (target === null) {
      return;
    }
    const key = this.makeEmptyScalar(recovery.colon);
    const source = this.src.slice(recovery.valueStart, recovery.valueEnd);
    const value = makeScalar(source);
    value.source = source;
    let end = recovery.valueEnd;
    if (end < this.n && this.isLineBreak(end)) {
      end = this.afterLineBreak(end);
    }
    value.range = [recovery.valueStart, recovery.valueEnd, end];
    const previous = target.items[target.items.length - 1];
    if (previous?.value !== null && previous?.value !== undefined) {
      previous.value.range[2] = Math.max(previous.value.range[2], recovery.colon);
    }
    target.items.push(makePair(key, value));
    for (const link of path) {
      link.range[1] = Math.max(link.range[1], end);
      link.range[2] = Math.max(link.range[2], end);
    }
    node.range[1] = Math.max(node.range[1], end);
    node.range[2] = Math.max(node.range[2], end);
  }

  private maybeComposeNestedMap(node: ParseNode | null): ParseNode | null {
    if (node?.kind !== "scalar") {
      return node;
    }
    const meta = (node as unknown as { nestedMap?: { colon: number; mapIndent: number } })
      .nestedMap;
    if (meta === undefined) {
      return node;
    }
    return this.composeNestedMap(node, meta);
  }

  private composeNestedMap(
    scalar: ParseScalarNode,
    meta: { colon: number; mapIndent: number; context?: string },
  ): ParseMapNode {
    const key = makeScalar(scalar.value);
    key.source = scalar.source;
    key.range = [scalar.range[0], meta.colon, meta.colon];
    this.i = meta.colon + 1;
    this.plainIndent = meta.mapIndent;
    this.plainContext = "map";
    let value = this.parseIndicatorValue(meta.mapIndent, false);
    value = this.maybeComposeNestedMap(value) ?? this.makeEmptyScalar(meta.colon + 1);
    const map = makeMap();
    map.items.push(makePair(key, value));
    map.range = [key.range[0], value.range[2], value.range[2]];
    let allowRest = true;
    if (meta.context === "seq") {
      let nextContent = this.i;
      while (
        nextContent < this.n &&
        (this.src[nextContent] === " " || this.src[nextContent] === "\t")
      ) {
        nextContent += 1;
      }
      if (nextContent >= this.n || this.isLineBreak(nextContent)) {
        nextContent = this.nextContentLine(this.i) ?? -1;
      }
      if (nextContent !== -1 && this.lineIndentOf(nextContent) <= meta.mapIndent) {
        allowRest = false;
      }
    }
    if (allowRest && this.i < this.n && !this.atDocMarker()) {
      const rest = this.parseBlockMap(meta.mapIndent, true);
      if (rest.items.length > 0) {
        map.items.push(...rest.items);
        map.range[1] = rest.range[1];
        map.range[2] = rest.range[2];
      }
    }
    return map;
  }

  private reportBadScalarStart(start: number): void {
    const first = start < this.n ? this.src[start] : "";
    if (first === "%") {
      this.recordError(
        "BAD_SCALAR_START",
        "Plain value cannot start with directive indicator character %",
        start,
        start + 1,
      );
    } else if (first === "," && this.flowDepth === 0) {
      this.recordError(
        "BAD_SCALAR_START",
        `Plain value cannot start with flow indicator character ${first}`,
        start,
        start + 1,
      );
    }
  }

  private keySignature(node: ParseNode | null): string | null {
    if (node === null) {
      return null;
    }
    if (node.kind === "scalar") {
      return `s:${node.type}:${String(node.value)}:${node.source}`;
    }
    if (node.kind === "alias") {
      return `a:${node.source}`;
    }
    if (node.kind === "map") {
      return `m:${JSON.stringify(node.items.map((pair) => [this.keySignature(pair.key), this.keySignature(pair.value)]))}`;
    }
    return `q:${JSON.stringify(node.items.map((item) => this.keySignature(item)))}`;
  }

  private isMergeKeyNode(key: ParseNode | null): boolean {
    return (
      key?.kind === "scalar" &&
      this.schema === "yaml-1.1" &&
      (key.mergeKey === true || (key.type === "PLAIN" && key.source === "<<"))
    );
  }

  private checkDuplicateKey(map: ParseMapNode, key: ParseNode | null): void {
    if (this.isMergeKeyNode(key)) {
      return;
    }
    const signature = this.keySignature(key);
    if (signature === null) {
      return;
    }
    for (const pair of map.items) {
      if (this.isMergeKeyNode(pair.key)) {
        continue;
      }
      if (this.keySignature(pair.key) === signature) {
        const start = key ? key.range[0] : map.range[0];
        this.recordError("DUPLICATE_KEY", "Map keys must be unique", start, start + 1);
        return;
      }
    }
  }

  private lineIndentOf(pos: number): number {
    const lineStart = this.lineStartIndex(pos);
    let index = lineStart;
    while (index < this.n && this.src[index] === " ") {
      index += 1;
    }
    return index - lineStart;
  }

  private lineIndent(): number {
    const lineStart = this.lineStartIndex(this.i);
    let index = lineStart;
    while (index < this.n && this.src[index] === " ") {
      index += 1;
    }
    return index - lineStart;
  }

  private makeEmptyScalar(pos: number): ParseScalarNode {
    const node = makeScalar(null);
    node.source = "";
    node.range = [pos, pos, pos];
    return node;
  }

  private parseInlineNode(key: boolean): ParseNode {
    const props = this.parseProperties();
    if (
      (props.tag !== undefined || props.anchor !== undefined) &&
      (this.i >= this.n || this.isLineBreak(this.i) || this.atLineStart())
    ) {
      const propEnd = this.i;
      if (this.i < this.n && this.isLineBreak(this.i)) {
        this.i = this.consumeLineBreak();
      }
      this.collectTrivia();
      if (key && (this.i >= this.n || this.lineIndent() <= this.lineIndentOf(propEnd))) {
        const empty = makeScalar(null);
        empty.source = "";
        empty.range = [propEnd, propEnd, propEnd];
        this.applyProperties(empty, props);
        return empty;
      }
      const node = this.parseBlockNode(this.plainIndent ?? this.lineIndent(), true);
      if (node) {
        this.applyProperties(node, props);
        return node;
      }
      if (this.i >= this.n) {
        const empty = makeScalar(null);
        empty.source = "";
        empty.range = [propEnd, propEnd, propEnd];
        this.applyProperties(empty, props);
        return empty;
      }
    }
    const ch = this.i < this.n ? this.src[this.i] : "";
    if (ch === "?" && this.isSep(this.i + 1)) {
      const node = this.parseBlockMap(this.column());
      this.applyProperties(node, props);
      return node;
    }
    let node: ParseNode;
    if (ch === "*") {
      node = this.parseAlias();
    } else if (ch === "[") {
      node = this.parseFlowSeq();
    } else if (ch === "{") {
      node = this.parseFlowMap();
    } else if (ch === '"') {
      node = this.parseDoubleQuoted();
    } else if (ch === "'") {
      node = this.parseSingleQuoted();
    } else if (ch === "|" || ch === ">") {
      node = this.parseBlockScalar(this.plainIndent ?? this.lineIndent());
    } else {
      node = this.parsePlain(key, this.plainIndent ?? this.lineIndent());
    }
    this.applyProperties(node, props);
    if (key) {
      this.finishKey(node);
    } else if (node.kind !== "map" && node.kind !== "seq" && !isBlockScalar(node)) {
      this.finishInline(node);
    }
    return node;
  }

  private applyProperties(node: ParseNode, props: Properties): void {
    if (props.tag !== undefined) {
      node.tag = props.tag;
    }
    if (props.anchor !== undefined) {
      node.anchor = props.anchor;
    }
    if (props.tagRange !== undefined) {
      Object.defineProperty(node, "tagRange", {
        value: props.tagRange,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  }

  private parseProperties(): Properties {
    const props: Properties = {};
    while (this.i < this.n) {
      this.skipInlineSpaces();
      if (this.i >= this.n) {
        break;
      }
      const ch = this.src[this.i];
      if (ch === "&") {
        this.i += 1;
        const start = this.i;
        while (this.i < this.n && !ANCHOR_STOP.includes(this.src[this.i]!)) {
          this.i += 1;
        }
        props.anchor = this.src.slice(start, this.i);
        continue;
      }
      if (ch === "!") {
        const parsed = this.parseTag();
        props.tag = parsed.tag;
        props.tagRange = parsed.range;
        continue;
      }
      break;
    }
    return props;
  }

  private decodeTagSuffix(text: string): string {
    if (!text.includes("%")) {
      return text;
    }
    try {
      return decodeURIComponent(text);
    } catch {
      return text.replace(/%[0-9A-Fa-f]{2}/g, (match) => {
        try {
          return decodeURIComponent(match);
        } catch {
          return match;
        }
      });
    }
  }

  private parseTag(): { tag: string | undefined; range: [number, number] } {
    const start = this.i;
    if (this.src.startsWith("!<", this.i)) {
      const close = this.src.indexOf(">", this.i + 2);
      if (close === -1) {
        this.i = this.n;
        return { tag: this.src.slice(start + 2), range: [start, this.i] };
      }
      this.i = close + 1;
      return { tag: this.src.slice(start + 2, close), range: [start, this.i] };
    }
    this.i += 1;
    while (
      this.i < this.n &&
      !ANCHOR_STOP.includes(this.src[this.i]!) &&
      this.src.charCodeAt(this.i) < 0x80
    ) {
      this.i += 1;
    }
    const range: [number, number] = [start, this.i];
    const token = this.src.slice(start, this.i);
    if (token === "!") {
      return { tag: "!", range };
    }
    if (token.startsWith("!!")) {
      const prefix = this.tags["!!"] ?? "tag:yaml.org,2002:";
      return { tag: prefix + this.decodeTagSuffix(token.slice(2)), range };
    }
    const next = token.indexOf("!", 1);
    if (next !== -1) {
      const handle = token.slice(0, next + 1);
      const prefix = this.tags[handle];
      if (prefix === undefined) {
        return { tag: undefined, range };
      }
      return { tag: prefix + this.decodeTagSuffix(token.slice(next + 1)), range };
    }
    const prefix = this.tags["!"];
    if (prefix !== undefined) {
      return { tag: prefix + this.decodeTagSuffix(token.slice(1)), range };
    }
    return { tag: token, range };
  }

  private parseAlias(): ParseAliasNode {
    const start = this.i;
    this.i += 1;
    const nameStart = this.i;
    while (this.i < this.n && !ANCHOR_STOP.includes(this.src[this.i]!)) {
      this.i += 1;
    }
    const node = makeAlias();
    node.source = this.src.slice(nameStart, this.i);
    node.range = [start, this.i, this.i];
    this.finishInline(node);
    return node;
  }

  private findFlowLimit(start: number, blockIndent: number): number | null {
    if (blockIndent < 0) {
      return null;
    }
    let index = this.afterLineBreak(this.lineEnd(start));
    while (index < this.n) {
      const lineStart = this.lineStartIndex(index);
      const lineEnd = this.lineEnd(index);
      const line = this.src.slice(lineStart, lineEnd);
      const trimmed = line.trim();
      if (trimmed.length !== 0 && !trimmed.startsWith("#")) {
        let spaces = 0;
        while (spaces < line.length && line[spaces] === " ") {
          spaces += 1;
        }
        if (spaces <= blockIndent) {
          if (trimmed.startsWith("]") || trimmed.startsWith("}")) {
            return null;
          }
          return lineStart;
        }
      }
      const next = this.afterLineBreak(lineEnd);
      if (next === index) {
        break;
      }
      index = next;
    }
    return null;
  }

  private parseFlowSeq(): ParseNode {
    const start = this.i;
    const outerFlow = this.flowDepth === 0;
    const previousLimit = this.flowLimit;
    if (outerFlow) {
      this.flowLimit = this.findFlowLimit(this.i + 1, this.plainIndent ?? -1);
    }
    this.i += 1;
    this.flowDepth += 1;
    let closed = false;
    const seq = makeSeq();
    let last: ParseNode | null = null;
    let lastEnd = this.i;
    while (this.i < this.n) {
      this.tick();
      const iterationStart = this.i;
      lastEnd = this.i;
      if (this.flowLimit !== null && this.i >= this.flowLimit) {
        if (last !== null) {
          last.range[2] = Math.max(last.range[2], this.flowLimit);
        }
        break;
      }
      this.collectFlowTrivia(last);
      if (this.i >= this.n || (this.flowLimit !== null && this.i >= this.flowLimit)) {
        if (last !== null && this.flowLimit !== null) {
          last.range[2] = Math.max(last.range[2], this.flowLimit);
        }
        break;
      }
      if (this.src[this.i] === "}") {
        const closePos = this.i;
        this.recordError(
          "BAD_INDENT",
          "Flow sequence in block collection must be sufficiently indented and end with a ]",
          closePos,
          closePos + 1,
        );
        this.i = closePos + 1;
        this.flowCloseEnd = closePos;
        const closeRest = this.src.slice(closePos + 1, this.lineEnd(closePos)).trim();
        if (last !== null && closeRest.length > 1) {
          const closing = this.src.lastIndexOf("]", this.lineEnd(closePos) - 1);
          const endPos = closing > closePos ? closing : this.lineEnd(closePos);
          seq.range = [start, closePos, endPos];
        } else if (closeRest.length === 0) {
          seq.range = [start, closePos, closePos + 1];
        } else {
          seq.range = [start, closePos, closePos];
        }
        this.flowDepth -= 1;
        if (outerFlow) {
          this.flowLimit = previousLimit;
        }
        return seq;
      }
      if (this.src[this.i] === "]") {
        this.i += 1;
        closed = true;
        break;
      }
      if (this.src[this.i] === ",") {
        this.i += 1;
        continue;
      }
      const node = this.parseFlowPairOrNode();
      seq.items.push(node);
      last = node;
      lastEnd = this.i;
      this.collectFlowTrivia(last);
      if (this.i < this.n && this.src[this.i] === ",") {
        this.i += 1;
      }
      if (this.i === iterationStart) {
        break;
      }
    }
    seq.range = [start, this.i, this.i];
    if (!closed) {
      if (start === 0 && this.i >= this.n) {
        const errorPos = lastEnd;
        this.recordError("MISSING_CHAR", "Flow sequence must end with a ]", errorPos, errorPos + 1);
        this.flowRootEnd = errorPos;
        seq.range = [start, errorPos, errorPos];
        this.flowDepth -= 1;
        if (outerFlow) {
          this.flowLimit = previousLimit;
        }
        return seq;
      }
      const errorPos = this.flowLimit ?? this.n;
      this.recordError(
        "BAD_INDENT",
        "Flow sequence in block collection must be sufficiently indented and end with a ]",
        errorPos,
        errorPos + 1,
      );
    }
    this.flowDepth -= 1;
    if (outerFlow) {
      this.flowLimit = previousLimit;
    }
    this.finishInline(seq);
    return seq;
  }

  private parseFlowPairOrNode(): ParseNode {
    const explicitSep =
      this.i + 1 >= this.n || this.isSep(this.i + 1) || ",]}".includes(this.src[this.i + 1]!);
    if (this.src[this.i] === "?" && explicitSep) {
      this.i += 1;
      this.collectFlowTrivia(null);
      const key = this.parseFlowNode(true);
      this.collectFlowTrivia(null);
      let value: ParseNode | null = null;
      if (this.i < this.n && this.src[this.i] === ":") {
        this.i += 1;
        value = this.parseFlowValue();
      }
      const map = makeMap();
      map.items.push(makePair(key, value));
      const start = key.range[0];
      const end = value ? value.range[2] : key.range[2];
      map.range = [start, end, end];
      return map;
    }
    const node = this.parseFlowNode(false);
    this.skipInlineSpaces();
    if (this.i < this.n && this.src[this.i] === ":") {
      this.i += 1;
      const value = this.parseFlowValue();
      const map = makeMap();
      map.items.push(makePair(node, value));
      map.range = [node.range[0], value.range[1], value.range[2]];
      return map;
    }
    if (this.i < this.n && (this.src[this.i] === "[" || this.src[this.i] === "{")) {
      this.recordError(
        "MISSING_CHAR",
        "Missing , or : between flow sequence items",
        this.i,
        this.i + 1,
      );
      const value = this.parseFlowNode(false);
      const map = makeMap();
      map.items.push(makePair(node, value));
      map.range = [node.range[0], value.range[1], value.range[2]];
      return map;
    }
    return node;
  }

  private parseFlowValue(): ParseNode {
    const emptyPos = this.skipInlineSpaces();
    if (this.i < this.n && this.src[this.i] === "#") {
      this.collectTrivia();
      if (this.i >= this.n) {
        return this.makeEmptyScalar(emptyPos);
      }
      const next = this.src[this.i];
      if (next === "," || next === "]" || next === "}") {
        return this.makeEmptyScalar(emptyPos);
      }
      return this.parseFlowNode(false);
    }
    if (this.i >= this.n) {
      return this.makeEmptyScalar(emptyPos);
    }
    const ch = this.src[this.i];
    if (ch === "," || ch === "]" || ch === "}") {
      return this.makeEmptyScalar(emptyPos);
    }
    if (this.isLineBreak(this.i)) {
      this.collectTrivia();
      if (this.i >= this.n) {
        return this.makeEmptyScalar(emptyPos);
      }
      const next = this.src[this.i];
      if (next === "," || next === "]" || next === "}") {
        return this.makeEmptyScalar(emptyPos);
      }
    }
    return this.parseFlowNode(false);
  }

  private parseFlowMap(): ParseMapNode {
    const start = this.i;
    const outerFlow = this.flowDepth === 0;
    const previousLimit = this.flowLimit;
    if (outerFlow) {
      this.flowLimit = this.findFlowLimit(this.i + 1, this.plainIndent ?? -1);
    }
    this.i += 1;
    this.flowDepth += 1;
    let closed = false;
    const map = makeMap();
    let last: ParseNode | null = null;
    let lastEnd = this.i;
    while (this.i < this.n) {
      this.tick();
      const iterationStart = this.i;
      lastEnd = this.i;
      if (this.flowLimit !== null && this.i >= this.flowLimit) {
        if (last !== null) {
          last.range[2] = Math.max(last.range[2], this.flowLimit);
        }
        break;
      }
      this.collectFlowTrivia(last);
      if (this.i >= this.n || (this.flowLimit !== null && this.i >= this.flowLimit)) {
        if (last !== null && this.flowLimit !== null) {
          last.range[2] = Math.max(last.range[2], this.flowLimit);
        }
        break;
      }
      if (this.src[this.i] === "]") {
        const closePos = this.i;
        this.recordError(
          "BAD_INDENT",
          "Flow map in block collection must be sufficiently indented and end with a }",
          closePos,
          closePos + 1,
        );
        this.i = closePos + 1;
        map.range = [start, closePos, closePos + 1];
        this.flowDepth -= 1;
        if (outerFlow) {
          this.flowLimit = previousLimit;
        }
        return map;
      }
      if (this.src[this.i] === "}") {
        this.i += 1;
        closed = true;
        break;
      }
      if (this.src[this.i] === ",") {
        this.i += 1;
        continue;
      }
      if (
        this.src[this.i] === "?" &&
        (this.i + 1 >= this.n || this.isSep(this.i + 1) || ",]}".includes(this.src[this.i + 1]!))
      ) {
        this.i += 1;
        this.collectFlowTrivia(null);
      }
      const key = this.parseFlowNode(true);
      this.collectFlowTrivia(null);
      let value: ParseNode | null = null;
      if (this.i < this.n && this.src[this.i] === ":") {
        this.i += 1;
        value = this.parseFlowValue();
      } else if (this.i < this.n && (this.src[this.i] === "[" || this.src[this.i] === "{")) {
        this.recordError(
          "MISSING_CHAR",
          "Missing , or : between flow map items",
          this.i,
          this.i + 1,
        );
        value = this.parseFlowNode(false);
      }
      this.checkDuplicateKey(map, key);
      map.items.push(makePair(key, value));
      last = value ?? key;
      lastEnd = this.i;
      this.collectFlowTrivia(last);
      if (this.i < this.n && this.src[this.i] === ",") {
        this.i += 1;
      }
      if (this.i === iterationStart) {
        break;
      }
    }
    if (!closed) {
      if (start === 0 && this.i >= this.n) {
        const errorPos = lastEnd;
        this.recordError("MISSING_CHAR", "Flow map must end with a }", errorPos, errorPos + 1);
        this.flowRootEnd = errorPos;
        map.range = [start, errorPos, errorPos];
        this.flowDepth -= 1;
        if (outerFlow) {
          this.flowLimit = previousLimit;
        }
        return map;
      }
      const errorPos = this.flowLimit ?? this.n;
      this.recordError(
        "BAD_INDENT",
        "Flow map in block collection must be sufficiently indented and end with a }",
        errorPos,
        errorPos + 1,
      );
    }
    this.flowDepth -= 1;
    if (outerFlow) {
      this.flowLimit = previousLimit;
    }
    map.range = [start, this.i, this.i];
    this.finishInline(map);
    return map;
  }

  private parseFlowNode(key: boolean): ParseNode {
    const trivia = this.takeTriviaForNode();
    const props = this.parseProperties();
    const ch = this.i < this.n ? this.src[this.i] : "";
    let node: ParseNode;
    if (ch === "*") {
      node = this.parseAliasFlow();
    } else if (ch === "[") {
      node = this.parseFlowSeq();
    } else if (ch === "{") {
      node = this.parseFlowMap();
    } else if (ch === '"') {
      node = this.parseDoubleQuoted();
    } else if (ch === "'") {
      node = this.parseSingleQuoted();
    } else {
      node = this.parsePlain(key, -1);
    }
    this.applyProperties(node, props);
    attachBefore(node, trivia);
    if (key) {
      this.finishKey(node);
    } else if (node.kind !== "map" && node.kind !== "seq") {
      this.finishInline(node);
    }
    return node;
  }

  private parseAliasFlow(): ParseAliasNode {
    const start = this.i;
    this.i += 1;
    const nameStart = this.i;
    while (this.i < this.n && !ANCHOR_STOP.includes(this.src[this.i]!)) {
      this.i += 1;
    }
    const node = makeAlias();
    node.source = this.src.slice(nameStart, this.i);
    node.range = [start, this.i, this.i];
    this.finishInline(node);
    return node;
  }

  private parsePlain(key: boolean, parentIndent: number, recover = false): ParseScalarNode {
    const node = makeScalar("");
    const start = this.i;
    const context = this.plainContext;
    const firstLineStart = this.lineStartIndex(start);
    let firstProbe = firstLineStart;
    while (firstProbe < this.n && (this.src[firstProbe] === " " || this.src[firstProbe] === "\t")) {
      firstProbe += 1;
    }
    const startAtFirst = firstProbe === start;
    this.reportBadScalarStart(start);
    if (start < this.n && this.src[start] === "%") {
      recover = true;
    }
    let value = "";
    let contentEnd = start;
    let haveText = false;
    let pendingBreaks = 1;
    let segmentStart = this.i;
    let nestedMappingReported = false;
    for (;;) {
      this.tick();
      let j = segmentStart;
      let stop = this.n;
      let terminator = "";
      while (j < this.n) {
        const ch = this.src[j];
        if (ch === "\n" || ch === "\r") {
          stop = j;
          terminator = "eol";
          break;
        }
        if (
          ch === "#" &&
          (j === segmentStart || this.src[j - 1] === " " || this.src[j - 1] === "\t")
        ) {
          stop = j;
          terminator = "comment";
          break;
        }
        if (key && ch === ":" && (j + 1 >= this.n || this.isSep(j + 1))) {
          stop = j;
          terminator = "colon";
          break;
        }
        if (this.inFlowPlainTerminator(j)) {
          stop = j;
          terminator = "flow";
          break;
        }
        j += 1;
      }
      let textEnd = stop;
      while (
        textEnd > segmentStart &&
        (this.src[textEnd - 1] === " " || this.src[textEnd - 1] === "\t")
      ) {
        textEnd -= 1;
      }
      const text = this.src.slice(segmentStart, textEnd);
      if (text.length > 0) {
        if (haveText) {
          value += pendingBreaks > 1 ? "\n".repeat(pendingBreaks - 1) : " ";
        }
        value += text;
        contentEnd = textEnd;
        haveText = true;
      }
      if (terminator !== "eol") {
        this.i = stop;
        break;
      }
      let breaks = 0;
      let contentPos = j;
      while (contentPos < this.n) {
        if (this.src[contentPos] === "\r" && this.src[contentPos + 1] === "\n") {
          contentPos += 2;
          breaks += 1;
        } else if (this.src[contentPos] === "\n" || this.src[contentPos] === "\r") {
          contentPos += 1;
          breaks += 1;
        } else {
          break;
        }
        let probe = contentPos;
        while (probe < this.n && (this.src[probe] === " " || this.src[probe] === "\t")) {
          probe += 1;
        }
        if (probe < this.n && this.isLineBreak(probe)) {
          contentPos = probe;
          continue;
        }
        contentPos = probe;
        break;
      }
      if (contentPos >= this.n || (this.flowLimit !== null && contentPos >= this.flowLimit)) {
        this.i = stop;
        break;
      }
      if (
        this.flowDepth === 0 &&
        contentPos < this.n &&
        this.src[contentPos] === ":" &&
        this.isSep(contentPos + 1)
      ) {
        this.i = stop;
        break;
      }
      if (
        !recover &&
        this.flowDepth === 0 &&
        contentPos < this.n &&
        (this.src[contentPos] === '"' || this.src[contentPos] === "'") &&
        (() => {
          const lineEnd = this.lineEnd(contentPos);
          const quoteChar = this.src[contentPos];
          let quoteOpen = true;
          for (let probe = contentPos + 1; probe < lineEnd; probe += 1) {
            const ch = this.src[probe];
            if (
              ch === "#" &&
              (probe === contentPos || this.src[probe - 1] === " " || this.src[probe - 1] === "\t")
            ) {
              return false;
            }
            if (quoteOpen) {
              if (quoteChar === '"' && ch === "\\") {
                probe += 1;
                continue;
              }
              if (ch === quoteChar) {
                if (quoteChar === "'" && this.src[probe + 1] === "'") {
                  probe += 1;
                  continue;
                }
                quoteOpen = false;
                continue;
              }
              if (
                ch === ":" &&
                (probe + 1 >= lineEnd ||
                  this.src[probe + 1] === " " ||
                  this.src[probe + 1] === "\t")
              ) {
                return true;
              }
            }
          }
          return false;
        })()
      ) {
        if (context === "map") {
          this.recordSoftError(
            "BLOCK_AS_IMPLICIT_KEY",
            "Nested mappings are not allowed in compact mappings",
            start,
            start + 1,
          );
        }
        this.recordSoftError(
          "MULTILINE_IMPLICIT_KEY",
          "Implicit keys need to be on a single line",
          start,
          contentPos + 1,
        );
      }
      if (
        !recover &&
        this.flowDepth === 0 &&
        contentPos < this.n &&
        this.src[contentPos] !== "#" &&
        this.src[contentPos] !== '"' &&
        this.src[contentPos] !== "'" &&
        (startAtFirst
          ? this.lineIndentOf(contentPos) >= this.lineIndentOf(start)
          : this.lineIndentOf(contentPos) >
            (parentIndent >= 0 ? parentIndent : this.lineIndentOf(start))) &&
        this.lineHasMappingAt(contentPos)
      ) {
        if (!nestedMappingReported) {
          nestedMappingReported = true;
          const colon = this.findMappingColonAt(contentPos);
          const colonPos = colon === -1 ? contentPos : colon;
          const emit = colon !== -1 ? this.recordError.bind(this) : this.recordSoftError.bind(this);
          if (context === "map") {
            emit(
              "BLOCK_AS_IMPLICIT_KEY",
              "Nested mappings are not allowed in compact mappings",
              start,
              start + 1,
            );
          }
          emit(
            "MULTILINE_IMPLICIT_KEY",
            "Implicit keys need to be on a single line",
            start,
            colonPos,
          );
          if (colon !== -1) {
            const extra = this.src.slice(contentPos, colon).trim();
            if (extra.length > 0) {
              if (haveText) {
                value += breaks > 1 ? "\n".repeat(breaks - 1) : " ";
              }
              value += extra;
              haveText = true;
            }
            contentEnd = colon;
            Object.defineProperty(node, "nestedMap", {
              value: { colon, mapIndent: this.lineIndentOf(start), context },
              enumerable: false,
            });
            this.i = colon;
            break;
          }
        }
      }
      const nextChar = this.src[contentPos];
      if (nextChar === "#") {
        this.i = stop;
        break;
      }
      if (this.atDocMarkerAt(contentPos)) {
        this.i = stop;
        break;
      }
      const nextLineStart = this.lineStartIndex(contentPos);
      const nextIndent = contentPos - nextLineStart;
      if (!recover && this.flowDepth === 0 && parentIndent >= 0 && nextIndent <= parentIndent) {
        this.i = stop;
        break;
      }
      if (!recover && nextChar === "?" && this.isSep(contentPos + 1)) {
        this.i = stop;
        break;
      }
      pendingBreaks = breaks;
      segmentStart = contentPos;
    }
    node.value = value;
    node.source = value;
    node.range = [start, contentEnd, contentEnd];
    return node;
  }

  private inFlowPlainTerminator(j: number): boolean {
    if (this.flowDepth === 0) {
      return false;
    }
    const ch = this.src[j];
    if (ch === "," || ch === "]" || ch === "}" || ch === "[" || ch === "{") {
      return true;
    }
    if (ch === ":") {
      const next = j + 1 < this.n ? this.src[j + 1] : "";
      return (
        next === "" || next === " " || next === "\t" || next === "," || next === "]" || next === "}"
      );
    }
    return false;
  }

  private readQuotedBreak(start: number): { breaks: number; end: number } {
    let { breaks, end } = this.readBreakRun(start);
    for (;;) {
      let probe = end;
      while (probe < this.n && (this.src[probe] === " " || this.src[probe] === "\t")) {
        probe += 1;
      }
      if (probe < this.n && this.isLineBreak(probe)) {
        const next = this.readBreakRun(probe);
        breaks += next.breaks;
        end = next.end;
        continue;
      }
      end = probe;
      break;
    }
    return { breaks, end };
  }

  private parseSingleQuoted(): ParseScalarNode {
    const start = this.i;
    this.i += 1;
    let closed = false;
    let value = "";
    while (this.i < this.n) {
      const ch = this.src[this.i];
      if (ch === "'") {
        if (this.src[this.i + 1] === "'") {
          value += "'";
          this.i += 2;
          continue;
        }
        this.i += 1;
        closed = true;
        break;
      }
      if (ch === "\\" && this.isLineBreak(this.i + 1)) {
        const { end } = this.readBreakRun(this.i + 1);
        let k = end;
        while (k < this.n && (this.src[k] === " " || this.src[k] === "\t")) {
          k += 1;
        }
        this.i = k;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        const { breaks, end } = this.readQuotedBreak(this.i);
        this.i = end;
        value = value.replace(/[ \t]+$/, "");
        if (breaks === 1) {
          value += " ";
        } else {
          value += "\n".repeat(breaks - 1);
        }
        continue;
      }
      value += ch;
      this.i += 1;
    }
    if (!closed) {
      value = value.replace(/[ \t]+$/, "");
      this.recordError("MISSING_CHAR", "Missing closing 'quote", this.n, this.n + 1);
    }
    const node = makeScalar(value);
    node.type = "QUOTE_SINGLE";
    node.source = value;
    node.range = [start, this.i, this.i];
    return node;
  }

  private parseDoubleQuoted(): ParseScalarNode {
    const start = this.i;
    this.i += 1;
    let closed = false;
    let value = "";
    while (this.i < this.n) {
      const ch = this.src[this.i];
      if (ch === '"') {
        this.i += 1;
        closed = true;
        break;
      }
      if (ch === "\\") {
        const next = this.src[this.i + 1];
        if (this.isLineBreak(this.i + 1)) {
          const { end } = this.readBreakRun(this.i + 1);
          let k = end;
          while (k < this.n && (this.src[k] === " " || this.src[k] === "\t")) {
            k += 1;
          }
          this.i = k;
          continue;
        }
        this.i += 2;
        value += this.decodeEscape(next ?? "", this.i - 1);
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        const { breaks, end } = this.readQuotedBreak(this.i);
        this.i = end;
        value = value.replace(/[ \t]+$/, "");
        if (breaks === 1) {
          value += " ";
        } else {
          value += "\n".repeat(breaks - 1);
        }
        continue;
      }
      value += ch;
      this.i += 1;
    }
    if (!closed) {
      value = value.replace(/[ \t]+$/, "");
      if (this.n > 0 && !this.isLineBreak(this.n - 1) && value.length > 0) {
        value = value.slice(0, -1);
      }
      this.recordError("MISSING_CHAR", 'Missing closing "quote', this.n, this.n + 1);
    }
    const node = makeScalar(value);
    node.type = "QUOTE_DOUBLE";
    node.source = value;
    node.range = [start, this.i, this.i];
    return node;
  }

  private decodeEscape(ch: string, at: number): string {
    switch (ch) {
      case "0":
        return "\0";
      case "a":
        return "\x07";
      case "b":
        return "\b";
      case "t":
      case "\t":
        return "\t";
      case "n":
        return "\n";
      case "v":
        return "\v";
      case "f":
        return "\f";
      case "r":
        return "\r";
      case "e":
        return "\x1b";
      case " ":
        return " ";
      case '"':
        return '"';
      case "/":
        return "/";
      case "\\":
        return "\\";
      case "N":
        return "\u0085";
      case "_":
        return "\u00a0";
      case "L":
        return "\u2028";
      case "P":
        return "\u2029";
      case "x":
        return this.readHexEscape(2, at);
      case "u":
        return this.readHexEscape(4, at);
      case "U":
        return this.readHexEscape(8, at);
      default: {
        this.recordError(
          "BAD_DQ_ESCAPE",
          `Invalid escape sequence \\${ch}`,
          Math.max(0, at - 1),
          at,
        );
        return `\\${ch}`;
      }
    }
  }

  private readHexEscape(length: number, at: number): string {
    const text = this.src.slice(at + 1, at + 1 + length);
    this.i = at + 1 + length;
    const code = Number.parseInt(text, 16);
    if (Number.isNaN(code)) {
      return "";
    }
    return String.fromCodePoint(code);
  }

  private parseBlockScalar(parentIndent: number): ParseScalarNode {
    const start = this.i;
    const literal = this.src[this.i] === "|";
    this.i += 1;
    let chomp: "clip" | "strip" | "keep" = "clip";
    let explicitIndent: number | undefined;
    while (this.i < this.n) {
      const ch = this.src[this.i];
      if (ch === "+" || ch === "-") {
        chomp = ch === "+" ? "keep" : "strip";
        this.i += 1;
      } else if (ch !== undefined && ch >= "1" && ch <= "9") {
        explicitIndent = Number(ch);
        this.i += 1;
      } else {
        break;
      }
    }
    this.skipInlineSpaces();
    let headerComment: string | null = null;
    if (this.i < this.n && this.src[this.i] === "#") {
      const end = this.lineEnd(this.i);
      headerComment = normalizeComment(this.src.slice(this.i + 1, end));
      this.i = end;
    }
    if (this.i < this.n && this.isLineBreak(this.i)) {
      this.i = this.consumeLineBreak();
    }
    let contentIndent = explicitIndent !== undefined ? parentIndent + explicitIndent : undefined;
    const lines: { text: string; more: boolean; hasNewline: boolean }[] = [];
    let badBlockIndent: { lineStart: number; contentStart: number; contentEnd: number } | null =
      null;
    let cursor = this.i;
    let lastNonEmptyEnd = cursor;
    let consumedEnd = cursor;
    while (cursor < this.n) {
      this.tick();
      const lineEnd = this.lineEnd(cursor);
      const lineText = this.src.slice(cursor, lineEnd);
      const hasNewline = lineEnd < this.n;
      let indent = 0;
      while (indent < lineText.length && lineText[indent] === " ") {
        indent += 1;
      }
      const blank = lineText.slice(indent).length === 0;
      if (!blank) {
        if (contentIndent === undefined) {
          if (indent <= parentIndent) {
            break;
          }
          contentIndent = indent;
        }
        if (indent < contentIndent) {
          if (explicitIndent !== undefined && indent > parentIndent) {
            this.recordError(
              "BAD_INDENT",
              "All mapping items must start at the same column",
              cursor,
              cursor + 1,
            );
            badBlockIndent = {
              lineStart: cursor,
              contentStart: cursor + indent,
              contentEnd: lineEnd,
            };
          }
          break;
        }
      }
      const after = hasNewline ? this.afterLineBreak(lineEnd) : lineEnd;
      if (!blank) {
        const text = lineText.slice(contentIndent ?? indent);
        lines.push({
          text,
          more: (contentIndent ?? indent) < indent || text.startsWith("\t"),
          hasNewline,
        });
        lastNonEmptyEnd = after;
      } else {
        lines.push({ text: "", more: false, hasNewline });
      }
      cursor = after;
      consumedEnd = after;
      if (!hasNewline) {
        break;
      }
    }
    this.i = chomp === "keep" ? consumedEnd : lastNonEmptyEnd;
    let value = this.foldBlockLines(lines, literal);
    value = this.chomp(value, chomp);
    const node = makeScalar(value);
    node.type = literal ? "BLOCK_LITERAL" : "BLOCK_FOLDED";
    node.source = value;
    node.range = [start, this.i, this.i];
    if (headerComment !== null) {
      node.comment = headerComment;
    }
    if (badBlockIndent !== null) {
      Object.defineProperty(node, "badBlockIndent", {
        value: badBlockIndent,
        enumerable: false,
      });
    }
    return node;
  }

  private foldBlockLines(
    lines: { text: string; more: boolean; hasNewline: boolean }[],
    literal: boolean,
  ): string {
    if (literal) {
      let out = "";
      for (const line of lines) {
        out += line.text;
        if (line.hasNewline) {
          out += "\n";
        }
      }
      return out;
    }
    let out = "";
    let pendingBreaks = 0;
    let prevText: string | null = null;
    let prevMore = false;
    for (const line of lines) {
      if (line.text === "") {
        pendingBreaks += line.hasNewline ? 1 : 0;
        if (!line.hasNewline) {
          pendingBreaks += 1;
        }
        continue;
      }
      if (prevText === null) {
        if (pendingBreaks > 0) {
          out += "\n".repeat(pendingBreaks);
        }
        out += line.text;
      } else {
        if (pendingBreaks === 1 && !prevMore && !line.more) {
          out += " ";
        } else if (pendingBreaks <= 1) {
          out += "\n";
        } else if (prevMore || line.more) {
          out += "\n".repeat(pendingBreaks);
        } else {
          out += "\n".repeat(pendingBreaks - 1);
        }
        out += line.text;
      }
      prevText = line.text;
      prevMore = line.more;
      pendingBreaks = line.hasNewline ? 1 : 0;
    }
    if (pendingBreaks > 0) {
      out += "\n".repeat(pendingBreaks);
    }
    return out;
  }

  private chomp(value: string, chomp: "clip" | "strip" | "keep"): string {
    if (chomp === "keep") {
      return value;
    }
    const trimmed = value.replace(/\n+$/, "");
    if (chomp === "strip") {
      return trimmed;
    }
    return trimmed.length > 0 ? `${trimmed}\n` : "";
  }

  private finishKey(node: ParseNode): void {
    this.skipInlineSpaces();
    node.range[2] = node.range[1];
  }

  private finishInline(node: ParseNode): void {
    if (node.kind === "map" || node.kind === "seq") {
      // keep range from collection parse, but consume trailing spaces/comments
    }
    let j = this.i;
    while (j < this.n && (this.src[j] === " " || this.src[j] === "\t")) {
      j += 1;
    }
    if (
      j < this.n &&
      this.src[j] === "#" &&
      j === this.i &&
      node.kind === "scalar" &&
      (node.type === "QUOTE_DOUBLE" || node.type === "QUOTE_SINGLE")
    ) {
      this.recordError(
        "MISSING_CHAR",
        "Comments must be separated from other tokens by white space characters",
        j,
        this.lineEnd(j),
      );
    }
    if (j < this.n && this.src[j] === "#") {
      const end = this.lineEnd(j);
      appendComment(node, normalizeComment(this.src.slice(j + 1, end)));
      const after = this.afterLineBreak(end);
      node.range[2] = after;
      this.i = after;
      return;
    }
    if (j < this.n && this.isLineBreak(j)) {
      const after = this.afterLineBreak(j);
      node.range[2] = after;
      this.i = after;
      return;
    }
    if (
      node.kind === "scalar" &&
      (node.type === "QUOTE_SINGLE" || node.type === "QUOTE_DOUBLE") &&
      j < this.n &&
      !",]}:".includes(this.src[j]!)
    ) {
      let end = j;
      while (end < this.n && !this.isLineBreak(end)) {
        if (
          this.src[end] === "#" &&
          (end === j || this.src[end - 1] === " " || this.src[end - 1] === "\t")
        ) {
          break;
        }
        if ("".includes(this.src[end]!)) {
          break;
        }
        end += 1;
      }
      let textEnd = end;
      while (textEnd > j && (this.src[textEnd - 1] === " " || this.src[textEnd - 1] === "\t")) {
        textEnd -= 1;
      }
      if (textEnd > j) {
        this.recordError("UNEXPECTED_TOKEN", "Unexpected scalar at node end", j, textEnd);
        const after = this.afterLineBreak(end);
        node.range[2] = after;
        this.i = after;
        return;
      }
    }
    node.range[2] = j;
    this.i = j;
  }

  private collectFlowTrivia(last: ParseNode | null): void {
    let probe = this.i;
    while (probe < this.n && (this.src[probe] === " " || this.src[probe] === "\t")) {
      probe += 1;
    }
    const sameLineComment = probe < this.n && this.src[probe] === "#";
    this.collectTrivia();
    if (last !== null && sameLineComment && this.pendingComments.length > 0) {
      const text = this.pendingComments.join("\n");
      if (text.length > 0) {
        appendComment(last, text);
      }
      this.pendingComments = [];
      this.pendingBlank = false;
      this.pendingBlankBefore = false;
      this.pendingCommentEnd = 0;
      this.pendingCommentLineEnd = 0;
      this.pendingCommentIndent = -1;
    }
  }

  private attachContinuationComments(last: ParseNode, indent: number): void {
    while (this.i < this.n) {
      this.tick();
      const lineStart = this.lineStartIndex(this.i);
      let probe = lineStart;
      let col = 0;
      let spaces = 0;
      while (probe < this.n && this.src[probe] === " ") {
        probe += 1;
        col += 1;
        spaces += 1;
      }
      if (probe < this.n && this.src[probe] === "\t") {
        if (spaces === 0) {
          return;
        }
        while (probe < this.n && (this.src[probe] === " " || this.src[probe] === "\t")) {
          probe += 1;
          col += 1;
        }
      }
      if (probe >= this.n || this.src[probe] !== "#" || col <= indent) {
        return;
      }
      if (this.i !== lineStart && this.i !== probe) {
        return;
      }
      const end = this.lineEnd(probe);
      const text = normalizeComment(this.src.slice(probe + 1, end));
      const existing = last.comment;
      last.comment = existing ? `${existing}\n${text}` : text;
      const after = this.afterLineBreak(end);
      last.range[2] = Math.max(last.range[2], after);
      this.i = after;
    }
  }

  private takeTriviaForNode(): Trivia {
    let comments = this.pendingComments;
    let blank = this.pendingBlankBefore;
    const end = this.pendingCommentEnd;
    if (this.rootFirst) {
      this.rootFirst = false;
      if (comments.length > 0 && comments[comments.length - 1] === "") {
        comments = [];
      }
      while (comments.length > 0 && comments[comments.length - 1] === "") {
        comments = comments.slice(0, -1);
      }
      blank = false;
    }
    this.pendingComments = [];
    this.pendingBlank = false;
    this.pendingBlankBefore = false;
    this.pendingCommentEnd = 0;
    this.pendingCommentLineEnd = 0;
    this.pendingCommentIndent = -1;
    return { comments, blank, end };
  }

  private collectTrivia(): void {
    let first = !this.atLineStart();
    while (this.i < this.n) {
      this.tick();
      while (this.i < this.n && (this.src[this.i] === " " || this.src[this.i] === "\t")) {
        this.i += 1;
      }
      if (this.i >= this.n) {
        break;
      }
      const ch = this.src[this.i];
      if (ch === "\n" || ch === "\r") {
        if (first) {
          first = false;
          this.i = this.consumeLineBreak();
        } else {
          this.pendingBlank = true;
          if (this.pendingComments.length === 0) {
            this.pendingBlankBefore = true;
          } else {
            this.pendingComments.push("");
          }
          this.i = this.consumeLineBreak();
        }
        continue;
      }
      if (ch === "#") {
        const end = this.lineEnd(this.i);
        this.pendingComments.push(normalizeComment(this.src.slice(this.i + 1, end)));
        const after = this.afterLineBreak(end);
        this.pendingCommentEnd = after;
        this.pendingCommentLineEnd = end;
        this.pendingCommentIndent = this.i - this.lineStartIndex(this.i);
        this.i = after;
        first = false;
        continue;
      }
      break;
    }
  }

  private readSameLineComment(): Trivia {
    const hash = this.i;
    const end = this.lineEnd(hash);
    const text = normalizeComment(this.src.slice(hash + 1, end));
    const after = this.afterLineBreak(end);
    this.i = after;
    return { comments: [text], blank: false, end: after };
  }

  private atAbsoluteLineStart(pos: number): boolean {
    const lineStart = this.lineStartIndex(pos);
    if (pos === lineStart) {
      return true;
    }
    return pos === lineStart + 1 && lineStart === 0 && this.src.charCodeAt(0) === 0xfeff;
  }

  private atLineStart(): boolean {
    return this.i === 0 || this.src[this.i - 1] === "\n" || this.src[this.i - 1] === "\r";
  }

  private column(): number {
    const lineStart = this.lineStartIndex(this.i);
    let index = lineStart;
    let spaces = 0;
    while (index < this.i) {
      const ch = this.src[index];
      if (ch === " ") {
        spaces += 1;
      } else if (ch !== "\t") {
        return this.i - lineStart;
      }
      index += 1;
    }
    return spaces;
  }

  private lineStartIndex(pos: number): number {
    let index = pos - 1;
    while (index >= 0 && this.src[index] !== "\n" && this.src[index] !== "\r") {
      index -= 1;
    }
    return index + 1;
  }

  private lineEnd(pos: number): number {
    let index = pos;
    while (index < this.n && this.src[index] !== "\n" && this.src[index] !== "\r") {
      index += 1;
    }
    return index;
  }

  private isLineBreak(pos: number): boolean {
    if (pos >= this.n) {
      return false;
    }
    return this.src[pos] === "\n" || this.src[pos] === "\r";
  }

  private consumeLineBreak(): number {
    return this.afterLineBreak(this.i);
  }

  private afterLineBreak(pos: number): number {
    if (pos >= this.n) {
      return pos;
    }
    if (this.src[pos] === "\r" && this.src[pos + 1] === "\n") {
      return pos + 2;
    }
    if (this.src[pos] === "\r" || this.src[pos] === "\n") {
      return pos + 1;
    }
    return pos;
  }

  private readBreakRun(pos: number): { breaks: number; end: number } {
    let index = pos;
    let breaks = 0;
    while (index < this.n) {
      if (this.src[index] === "\r" && this.src[index + 1] === "\n") {
        index += 2;
        breaks += 1;
      } else if (this.src[index] === "\n" || this.src[index] === "\r") {
        index += 1;
        breaks += 1;
      } else {
        break;
      }
    }
    return { breaks, end: index };
  }

  private skipInlineSpaces(): number {
    while (this.i < this.n && (this.src[this.i] === " " || this.src[this.i] === "\t")) {
      this.i += 1;
    }
    return this.i;
  }

  private isSep(pos: number): boolean {
    if (pos >= this.n) {
      return true;
    }
    const ch = this.src[pos];
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
  }

  private atDocStart(): boolean {
    return this.atDocMarkerAt(this.i) && this.src.startsWith("---", this.i);
  }

  private atDocEnd(): boolean {
    return this.atDocMarkerAt(this.i) && this.src.startsWith("...", this.i);
  }

  private atDocMarker(): boolean {
    return this.atDocStart() || this.atDocEnd();
  }

  private atDocMarkerAt(pos: number): boolean {
    if (pos + 3 > this.n) {
      return false;
    }
    if (!this.atAbsoluteLineStart(pos)) {
      return false;
    }
    const marker = this.src.slice(pos, pos + 3);
    if (marker !== "---" && marker !== "...") {
      return false;
    }
    return this.isSep(pos + 3);
  }

  private scanMappingIndicator(start: number): boolean {
    let depth = 0;
    let quote = "";
    let plainStarted = false;
    let propertyToken = false;
    let j = start;
    while (j < this.n) {
      const ch = this.src[j];
      if (quote !== "") {
        if (quote === '"' && ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === quote) {
          if (quote === "'" && this.src[j + 1] === "'") {
            j += 2;
            continue;
          }
          quote = "";
          plainStarted = true;
        }
        j += 1;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        return false;
      }
      if (ch === " " || ch === "\t") {
        if (propertyToken) {
          propertyToken = false;
          plainStarted = false;
        }
        j += 1;
        continue;
      }
      if (ch === "#" && (j === start || this.src[j - 1] === " " || this.src[j - 1] === "\t")) {
        return false;
      }
      if (!plainStarted && !propertyToken && (ch === "&" || ch === "!")) {
        propertyToken = true;
        j += 1;
        continue;
      }
      if (propertyToken) {
        j += 1;
        continue;
      }
      if (!plainStarted && (ch === '"' || ch === "'")) {
        quote = ch;
        j += 1;
        continue;
      }
      if (ch === "[" || ch === "{") {
        if (!plainStarted) {
          depth += 1;
          j += 1;
          continue;
        }
        j += 1;
        continue;
      }
      if (ch === "]" || ch === "}") {
        if (depth > 0) {
          depth -= 1;
          plainStarted = false;
          j += 1;
          continue;
        }
        plainStarted = true;
        j += 1;
        continue;
      }
      if (ch === ":" && (j + 1 >= this.n || this.isSep(j + 1))) {
        if (depth === 0) {
          return true;
        }
        plainStarted = false;
        j += 1;
        continue;
      }
      if (ch === "," && depth > 0) {
        plainStarted = false;
        j += 1;
        continue;
      }
      plainStarted = true;
      j += 1;
    }
    return false;
  }

  private findMappingColonAt(start: number): number {
    let depth = 0;
    let quote = "";
    let plainStarted = false;
    let propertyToken = false;
    let j = start;
    while (j < this.n) {
      const ch = this.src[j];
      if (quote !== "") {
        if (quote === '"' && ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === quote) {
          if (quote === "'" && this.src[j + 1] === "'") {
            j += 2;
            continue;
          }
          quote = "";
          plainStarted = true;
        }
        j += 1;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        return -1;
      }
      if (ch === " " || ch === "\t") {
        if (propertyToken) {
          propertyToken = false;
          plainStarted = false;
        }
        j += 1;
        continue;
      }
      if (ch === "#" && (j === start || this.src[j - 1] === " " || this.src[j - 1] === "\t")) {
        return -1;
      }
      if (!plainStarted && !propertyToken && (ch === "&" || ch === "!")) {
        propertyToken = true;
        j += 1;
        continue;
      }
      if (propertyToken) {
        j += 1;
        continue;
      }
      if (!plainStarted && (ch === '"' || ch === "'")) {
        quote = ch;
        j += 1;
        continue;
      }
      if (ch === "[" || ch === "{") {
        if (!plainStarted) {
          depth += 1;
        }
        j += 1;
        continue;
      }
      if (ch === "]" || ch === "}") {
        if (depth > 0) {
          depth -= 1;
          plainStarted = false;
        }
        j += 1;
        continue;
      }
      if (ch === ":" && (j + 1 >= this.n || this.isSep(j + 1))) {
        return j;
      }
      if (ch === "," && depth > 0) {
        plainStarted = false;
        j += 1;
        continue;
      }
      plainStarted = true;
      j += 1;
    }
    return -1;
  }

  private lineHasMappingAt(start: number): boolean {
    return this.scanMappingIndicator(start);
  }

  private lineHasMapping(): boolean {
    return this.scanMappingIndicator(this.i);
  }
}

function resolveIntCandidates(
  schema: "core" | "yaml-1.1",
): { tag: string; format?: string; variant?: number }[] {
  if (schema === "yaml-1.1") {
    return [
      { tag: "int", format: "OCT" },
      { tag: "int", format: "HEX" },
      { tag: "int", format: "BIN" },
      { tag: "int", format: "TIME" },
      { tag: "int" },
    ];
  }
  return [{ tag: "int", format: "OCT" }, { tag: "int", format: "HEX" }, { tag: "int" }];
}

function resolveFloatCandidates(
  schema: "core" | "yaml-1.1",
): { tag: string; format?: string; variant?: number }[] {
  const candidates: { tag: string; format?: string; variant?: number }[] = [
    { tag: "float", format: "EXP" },
    { tag: "float", variant: 0 },
    { tag: "float", variant: 1 },
  ];
  if (schema === "yaml-1.1") {
    candidates.push({ tag: "float", format: "TIME" });
  }
  return candidates;
}

function implicitCandidates(
  schema: "core" | "yaml-1.1",
): { tag: string; format?: string; variant?: number }[] {
  const candidates: { tag: string; format?: string; variant?: number }[] = [{ tag: "null" }];
  if (schema === "yaml-1.1") {
    candidates.push({ tag: "bool", variant: 0 }, { tag: "bool", variant: 1 });
  } else {
    candidates.push({ tag: "bool" });
  }
  candidates.push(...resolveIntCandidates(schema), ...resolveFloatCandidates(schema));
  if (schema === "yaml-1.1") {
    candidates.push({ tag: "timestamp" });
  }
  return candidates;
}

function resolveWithCandidates(
  node: ParseScalarNode,
  candidates: { tag: string; format?: string; variant?: number }[],
  schema: "core" | "yaml-1.1",
): boolean {
  for (const candidate of candidates) {
    const test = scalarTagTest({
      schema,
      tag: `tag:yaml.org,2002:${candidate.tag}`,
      format: candidate.format,
      variant: candidate.variant,
    });
    if (!test || !test.test(node.source)) {
      continue;
    }
    const result = resolveScalarTag(
      {
        schema,
        tag: `tag:yaml.org,2002:${candidate.tag}`,
        format: candidate.format,
        variant: candidate.variant,
        source: node.source,
      },
      () => undefined,
    );
    node.value = result.value;
    if (result.minFractionDigits !== undefined) {
      node.minFractionDigits = result.minFractionDigits;
    }
    if (candidate.format !== undefined) {
      node.format = candidate.format;
    }
    return true;
  }
  return false;
}

interface ResolveContext {
  warn(code: string, message: string, range: Range | [number, number]): void;
  error(code: string, message: string, range: Range | [number, number]): void;
  duplicate(start: number, end: number): void;
}

const PREFIX = "tag:yaml.org,2002:";
const SCALAR_TAGS = new Set([
  "str",
  "null",
  "bool",
  "int",
  "float",
  "binary",
  "timestamp",
  "merge",
]);

function nodeTagRange(node: ParseNode): Range | [number, number] {
  const value = (node as unknown as { tagRange?: Range }).tagRange;
  return value ?? [node.range[0], node.range[0]];
}

function resolveScalar(
  node: ParseScalarNode,
  schema: "core" | "yaml-1.1",
  key: boolean,
  ctx: ResolveContext,
): void {
  const explicit = node.tag;
  if (explicit !== undefined) {
    const range = nodeTagRange(node);
    if (explicit === "!") {
      node.value = node.source;
      return;
    }
    if (explicit.startsWith(PREFIX)) {
      const name = explicit.slice(PREFIX.length);
      if (name === "str") {
        node.value = node.source;
        return;
      }
      if (name === "merge") {
        if (schema === "yaml-1.1") {
          const test = scalarTagTest({ schema, tag: explicit });
          if (!test || !test.test(node.source)) {
            node.value = node.source;
            ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${explicit}`, range);
            return;
          }
        }
        const merge = resolveMergeTag(node.source);
        node.value = merge.value;
        node.mergeKey = true;
        return;
      }
      if (name === "int") {
        if (!resolveWithCandidates(node, resolveIntCandidates(schema), schema)) {
          node.value = node.source;
          ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${explicit}`, range);
        }
        return;
      }
      if (name === "float") {
        if (!resolveWithCandidates(node, resolveFloatCandidates(schema), schema)) {
          node.value = node.source;
          ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${explicit}`, range);
        }
        return;
      }
      if (name === "binary" || name === "timestamp") {
        try {
          const result = resolveScalarTag(
            { schema, tag: explicit, source: node.source },
            () => undefined,
          );
          node.value = result.value;
        } catch (error) {
          node.value = node.source;
          ctx.error("TAG_RESOLVE_FAILED", (error as Error).message, range);
        }
        return;
      }
      if (name === "null" || name === "bool") {
        let variant: number | undefined;
        if (name === "bool" && schema === "yaml-1.1") {
          const falseTest = scalarTagTest({ schema, tag: explicit, variant: 1 });
          variant = falseTest?.test(node.source) ? 1 : 0;
        }
        const test = scalarTagTest({ schema, tag: explicit, variant });
        if (test?.test(node.source)) {
          const result = resolveScalarTag(
            { schema, tag: explicit, source: node.source, variant },
            () => undefined,
          );
          node.value = result.value;
        } else {
          node.value = node.source;
          ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${explicit}`, range);
        }
        return;
      }
      if (
        name === "seq" ||
        name === "map" ||
        name === "set" ||
        name === "omap" ||
        name === "pairs"
      ) {
        node.value = node.source;
        return;
      }
      node.value = node.source;
      ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${explicit}`, range);
      return;
    }
    node.value = node.source;
    ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${explicit}`, range);
    return;
  }
  if (node.type !== "PLAIN") {
    node.value = node.source;
    return;
  }
  if (schema === "yaml-1.1" && key && node.source === "<<") {
    const merge = resolveMergeTag(node.source);
    node.value = merge.value;
    node.mergeKey = true;
    return;
  }
  if (resolveWithCandidates(node, implicitCandidates(schema), schema)) {
    return;
  }
  node.value = node.source;
}

function resolveDuplicates(items: ParsePairNode[], ctx: ResolveContext): void {
  const seen: unknown[] = [];
  for (const pair of items) {
    if (pair.key?.kind !== "scalar" || pair.key.mergeKey) {
      continue;
    }
    const value = pair.key.value;
    if (seen.some((entry) => entry === value)) {
      ctx.duplicate(pair.key.range[0], pair.key.range[0] + 1);
    } else {
      seen.push(value);
    }
  }
}

function resolveNode(
  node: ParseNode,
  schema: "core" | "yaml-1.1",
  ctx: ResolveContext,
  key = false,
): void {
  if (node.kind === "scalar") {
    resolveScalar(node, schema, key, ctx);
    return;
  }
  if (node.kind === "alias") {
    return;
  }
  if (node.kind === "map") {
    for (const pair of node.items) {
      if (pair.key) {
        resolveNode(pair.key, schema, ctx, true);
      }
      if (pair.value) {
        resolveNode(pair.value, schema, ctx, false);
      }
    }
    resolveCollections(node, schema, ctx);
    resolveDuplicates(node.items, ctx);
    return;
  }
  for (const item of node.items) {
    resolveNode(item, schema, ctx, false);
  }
  resolveCollections(node, schema, ctx);
}

function resolveCollections(
  node: ParseMapNode | ParseSeqNode,
  _schema: "core" | "yaml-1.1",
  ctx: ResolveContext,
): void {
  const tag = node.tag;
  if (tag === undefined || tag === "!") {
    return;
  }
  const range = nodeTagRange(node);
  if (!tag.startsWith(PREFIX)) {
    ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${tag}`, range);
    return;
  }
  const name = tag.slice(PREFIX.length);
  const kind = node.kind;
  const legacy = _schema === "yaml-1.1";
  if (SCALAR_TAGS.has(name)) {
    if (legacy) {
      ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${tag}`, range);
    } else {
      ctx.warn(
        "BAD_COLLECTION_TYPE",
        `${tag} used for ${kind} collection, but expects scalar`,
        range,
      );
    }
    return;
  }
  if (name === "seq" || name === "map") {
    const expected = name;
    if (kind !== expected) {
      ctx.warn(
        "BAD_COLLECTION_TYPE",
        `${tag} used for ${kind} collection, but expects ${expected}`,
        range,
      );
    }
    return;
  }
  if (name === "set" || name === "omap" || name === "pairs") {
    const expected = name === "set" ? "map" : "seq";
    if (kind !== expected) {
      if (legacy) {
        ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${tag}`, range);
      } else {
        ctx.warn(
          "BAD_COLLECTION_TYPE",
          `${tag} used for ${kind} collection, but expects ${expected}`,
          range,
        );
      }
      return;
    }
    const api = {
      isMap(value: unknown): value is { items: unknown[] } {
        return (
          typeof value === "object" && value !== null && (value as { kind?: string }).kind === "map"
        );
      },
      isSeq(value: unknown): value is { items: unknown[] } {
        return (
          typeof value === "object" && value !== null && (value as { kind?: string }).kind === "seq"
        );
      },
      isPair(value: unknown): value is { key: unknown; value: unknown } {
        return (
          typeof value === "object" &&
          value !== null &&
          (value as { kind?: string }).kind === "pair"
        );
      },
      isScalar(value: unknown): value is { value: unknown } {
        return (
          typeof value === "object" &&
          value !== null &&
          (value as { kind?: string }).kind === "scalar"
        );
      },
      pair(key: unknown, value: unknown): { kind: string; key: unknown; value: unknown } {
        return makePair(key as ParseNode | null, value as ParseNode | null);
      },
      scalar(value: unknown): { kind: string; value: unknown } {
        return makeScalar(value);
      },
    };
    const result = resolveCollectionTag(tag, node, api, (message: string) =>
      ctx.error("TAG_RESOLVE_FAILED", message, range),
    );
    if (result.collectionType !== undefined) {
      node.collectionType = result.collectionType;
    }
    return;
  }
  ctx.warn("TAG_RESOLVE_FAILED", `Unresolved tag: ${tag}`, range);
}

export function parseYaml(source: string): ParseDocumentResult {
  const parser = new Parser(source);
  const result = parser.parse();
  if (result.contents) {
    resolveNode(result.contents, result.schema, {
      warn(code, message, range) {
        parser.recordWarning(code, message, range[0], range[1]);
      },
      error(code, message, range) {
        parser.recordError(code, message, range[0], range[1]);
      },
      duplicate(start, end) {
        parser.recordErrorSorted("DUPLICATE_KEY", "Map keys must be unique", start, end);
      },
    });
  }
  const isSoft = (diagnostic: ParseDiagnostic): boolean => {
    return (diagnostic as unknown as { soft?: boolean }).soft === true;
  };
  const softErrors = result.errors.filter((diagnostic) => isSoft(diagnostic));
  const hardErrors = result.errors.filter((diagnostic) => !isSoft(diagnostic));
  if (
    softErrors.some((diagnostic) => diagnostic.code === "BLOCK_AS_IMPLICIT_KEY") &&
    hardErrors.length > 0 &&
    hardErrors.every((diagnostic) => diagnostic.code === "UNEXPECTED_TOKEN")
  ) {
    result.errors.splice(0, result.errors.length, ...softErrors);
  } else if (
    hardErrors.length === 0 &&
    softErrors.filter((diagnostic) => diagnostic.code === "BLOCK_AS_IMPLICIT_KEY").length > 1
  ) {
    const first = softErrors.findIndex((diagnostic) => diagnostic.code === "BLOCK_AS_IMPLICIT_KEY");
    result.errors.splice(0, result.errors.length, ...softErrors.slice(first, first + 2));
  }
  if (result.errors.some((diagnostic) => !isSoft(diagnostic)) || result.warnings.length > 0) {
    const kept = result.errors.filter((diagnostic) => !isSoft(diagnostic));
    result.errors.splice(0, result.errors.length, ...kept);
  }
  return result;
}
