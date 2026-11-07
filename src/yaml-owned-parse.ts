import {
  Alias,
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
  type ParsedDocument,
  type ParsedNode,
} from "./yaml-ast.ts";
import { convertDocument } from "./yaml-document.ts";
import type { KeyFormatting } from "./yaml-key-stringifier.ts";
import type { ParseDocumentResult, ParseNode } from "./yaml-parse.ts";

const yamlPrefix = "tag:yaml.org,2002:";

interface SchemaTagRecord {
  tag: string;
  default: boolean | "key";
  format?: string;
}

const coreTags: SchemaTagRecord[] = [
  { tag: `${yamlPrefix}map`, default: true },
  { tag: `${yamlPrefix}seq`, default: true },
  { tag: `${yamlPrefix}str`, default: true },
  { tag: `${yamlPrefix}null`, default: true },
  { tag: `${yamlPrefix}bool`, default: true },
  { tag: `${yamlPrefix}int`, default: true, format: "OCT" },
  { tag: `${yamlPrefix}int`, default: true },
  { tag: `${yamlPrefix}int`, default: true, format: "HEX" },
  { tag: `${yamlPrefix}float`, default: true },
  { tag: `${yamlPrefix}float`, default: true, format: "EXP" },
  { tag: `${yamlPrefix}float`, default: true },
];

const legacyTags: SchemaTagRecord[] = [
  { tag: `${yamlPrefix}map`, default: true },
  { tag: `${yamlPrefix}seq`, default: true },
  { tag: `${yamlPrefix}str`, default: true },
  { tag: `${yamlPrefix}null`, default: true },
  { tag: `${yamlPrefix}bool`, default: true },
  { tag: `${yamlPrefix}bool`, default: true },
  { tag: `${yamlPrefix}int`, default: true, format: "BIN" },
  { tag: `${yamlPrefix}int`, default: true, format: "OCT" },
  { tag: `${yamlPrefix}int`, default: true },
  { tag: `${yamlPrefix}int`, default: true, format: "HEX" },
  { tag: `${yamlPrefix}float`, default: true },
  { tag: `${yamlPrefix}float`, default: true, format: "EXP" },
  { tag: `${yamlPrefix}float`, default: true },
  { tag: `${yamlPrefix}binary`, default: false },
  { tag: `${yamlPrefix}merge`, default: "key" },
  { tag: `${yamlPrefix}omap`, default: false },
  { tag: `${yamlPrefix}pairs`, default: false },
  { tag: `${yamlPrefix}set`, default: false },
  { tag: `${yamlPrefix}int`, default: true, format: "TIME" },
  { tag: `${yamlPrefix}float`, default: true, format: "TIME" },
  { tag: `${yamlPrefix}timestamp`, default: true },
];

const coreKnownOrder = ["binary", "timestamp", "set", "omap", "pairs", "merge"] as const;

function ownNode(value: ParseNode | null): ParsedNode | null {
  if (!value) {
    return null;
  }
  const pairValue = value as unknown as {
    kind: string;
    key?: ParseNode | null;
    value?: ParseNode | null;
  };
  if (pairValue.kind === "pair") {
    const pair = new Pair<unknown, unknown>(null, null);
    pair.key = ownNode(pairValue.key ?? null);
    pair.value = ownNode(pairValue.value ?? null);
    return pair as unknown as ParsedNode;
  }
  let node: ParsedNode;
  if (value.kind === "scalar") {
    const scalar = new Scalar(value.value);
    scalar.type = value.type;
    scalar.source = value.source;
    scalar.format = value.format;
    scalar.minFractionDigits = value.minFractionDigits;
    if (value.mergeKey) {
      scalar.mergeKey = true;
    }
    node = scalar as ParsedNode;
  } else if (value.kind === "alias") {
    node = new Alias(value.source) as ParsedNode;
  } else if (value.kind === "map") {
    const map = new YAMLMap();
    if (value.collectionType === "set") {
      map.collectionType = "set";
    }
    map.items = value.items.map((pair) => {
      const owned = new Pair<unknown, unknown>(null, null);
      owned.key = ownNode(pair.key);
      owned.value = ownNode(pair.value);
      return owned;
    });
    node = map as ParsedNode;
  } else {
    const sequence = new YAMLSeq();
    if (value.collectionType === "omap") {
      sequence.collectionType = "omap";
    }
    sequence.items = value.items.map((item) => ownNode(item));
    node = sequence as ParsedNode;
  }
  node.range = [value.range[0], value.range[1], value.range[2]];
  node.tag = value.tag;
  node.anchor = value.anchor;
  node.comment = value.comment;
  node.commentBefore = value.commentBefore;
  node.spaceBefore = value.spaceBefore;
  return node;
}

function collectInvokedCoreKnownTags(value: ParseNode | null, invoked: Set<string>): void {
  if (!value) {
    return;
  }
  const pairValue = value as unknown as {
    kind: string;
    key?: ParseNode | null;
    value?: ParseNode | null;
  };
  if (pairValue.kind === "pair") {
    collectInvokedCoreKnownTags(pairValue.key ?? null, invoked);
    collectInvokedCoreKnownTags(pairValue.value ?? null, invoked);
    return;
  }
  if (value.kind === "scalar") {
    if (value.tag === `${yamlPrefix}binary` && value.value instanceof Uint8Array) {
      invoked.add("binary");
    } else if (value.tag === `${yamlPrefix}timestamp` && value.value instanceof Date) {
      invoked.add("timestamp");
    } else if (value.tag === `${yamlPrefix}merge` && typeof value.value === "symbol") {
      invoked.add("merge");
    }
    return;
  }
  if (value.kind === "alias") {
    return;
  }
  if (value.kind === "map") {
    if (value.tag === `${yamlPrefix}set` && value.collectionType === "set") {
      invoked.add("set");
    }
    for (const pair of value.items) {
      collectInvokedCoreKnownTags(pair.key, invoked);
      collectInvokedCoreKnownTags(pair.value, invoked);
    }
    return;
  }
  if (value.tag === `${yamlPrefix}omap` && value.collectionType === "omap") {
    invoked.add("omap");
  } else if (value.tag === `${yamlPrefix}pairs`) {
    invoked.add("pairs");
  }
  for (const item of value.items) {
    collectInvokedCoreKnownTags(item, invoked);
  }
}

function schemaTags(result: ParseDocumentResult, contents: ParseNode | null): SchemaTagRecord[] {
  if (result.schema === "yaml-1.1") {
    return legacyTags;
  }
  const invoked = new Set<string>();
  collectInvokedCoreKnownTags(contents, invoked);
  const records = [...coreTags];
  for (const name of coreKnownOrder) {
    if (invoked.has(name)) {
      records.push({ tag: `${yamlPrefix}${name}`, default: false });
    }
  }
  return records;
}

interface OwnedIssue extends Error {
  code: string;
  pos: [number, number];
  linePos: [{ line: number; col: number }, { line: number; col: number }];
}

function toIssue(diagnostic: ParseDocumentResult["errors"][number], name: string): OwnedIssue {
  const issue = new Error(diagnostic.message) as OwnedIssue;
  issue.name = name;
  issue.code = diagnostic.code;
  issue.pos = [diagnostic.pos[0], diagnostic.pos[1]];
  issue.linePos = [
    { line: diagnostic.linePos[0].line, col: diagnostic.linePos[0].col },
    { line: diagnostic.linePos[1].line, col: diagnostic.linePos[1].col },
  ];
  return issue;
}

/** Build a parsed document entirely from the independent parser result. */
export function buildOwnedDocument(result: ParseDocumentResult): ParsedDocument {
  const contents = ownNode(result.contents);
  const keyFormatting: KeyFormatting = {
    schema: result.schema,
    tagPrefixes: { ...result.tags },
    schemaTags: schemaTags(result, result.contents),
  };
  return {
    contents,
    errors: result.errors.map((diagnostic) => toIssue(diagnostic, "YAMLParseError")),
    warnings: result.warnings.map((diagnostic) => toIssue(diagnostic, "YAMLWarning")),
    range: [result.range[0], result.range[1], result.range[2]],
    get: (key, keepScalar) =>
      contents instanceof YAMLMap || contents instanceof YAMLSeq
        ? contents.get(key, keepScalar)
        : undefined,
    toJS: (conversionOptions) =>
      convertDocument(contents, conversionOptions, false, "", keyFormatting),
    toJSON: (arg) => convertDocument(contents, {}, true, arg, keyFormatting),
  };
}
