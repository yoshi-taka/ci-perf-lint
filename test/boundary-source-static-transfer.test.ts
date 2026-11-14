import { expect, test } from "bun:test";
import { readStaticSourceTransfer } from "../src/repository-diagnostics/source-audit-static-transfer.ts";

test("normalizes lazy declaration names and side-effect null specifiers without reading bodies", () => {
  const source = 'import "./setup";';
  const imported = { type: "IdentifierName", name: "format" };
  const metadata = {
    program: {
      body: [
        {
          type: "FunctionDeclaration",
          get body(): never {
            throw new Error("must not read");
          },
        },
        {
          type: "ImportDeclaration",
          start: 0,
          source: { value: "./setup" },
          importKind: "value",
          specifiers: null,
        },
        {
          type: "ImportDeclaration",
          start: 1,
          source: { value: "pkg" },
          importKind: "value",
          specifiers: [
            { type: "ImportSpecifier", importKind: "value", imported },
            {
              type: "ImportSpecifier",
              importKind: "type",
              imported: { type: "StringLiteral", value: "type-name" },
            },
          ],
        },
        {
          type: "ExportFromDeclaration",
          start: 2,
          source: { value: "pkg" },
          exportKind: "value",
          specifiers: [
            {
              type: "ExportSpecifier",
              exportKind: "value",
              local: { type: "IdentifierName", name: "local" },
            },
          ],
        },
        { type: "ExportAllDeclaration", start: 3, source: { value: "pkg" }, exportKind: "type" },
      ],
    },
    comments: [],
  };
  const transferred = readStaticSourceTransfer(metadata, source, "a.ts");
  expect(transferred).toBeDefined();
  expect(transferred?.program.body[0]).toMatchObject({ type: "ImportDeclaration", specifiers: [] });
  expect(transferred?.program.body[1]).toMatchObject({
    specifiers: [
      { imported: { type: "Identifier", name: "format" } },
      { imported: { type: "Literal", value: "type-name" }, importKind: "type" },
    ],
  });
  expect(transferred?.program.body[2]).toMatchObject({
    type: "ExportNamedDeclaration",
    specifiers: [{ local: { type: "Identifier", name: "local" } }],
  });
  expect(transferred?.program.body[3]).toMatchObject({
    type: "ExportAllDeclaration",
    exportKind: "type",
  });
  imported.name = "changed";
  expect(transferred?.program.body[1]).toMatchObject({
    specifiers: [{ imported: { name: "format" } }, {}],
  });
});

test("reconstructs directive comments and matches JS-only eager hashbang synthesis", () => {
  const source =
    "#!oxlint-disable import/extensions\n// 日本語🌟\r\n/* oxlint-disable no-restricted-imports */";
  const lineStart = source.indexOf("//");
  const blockStart = source.indexOf("/*");
  const hashbang = {
    start: 0,
    end: source.indexOf("\n"),
    value: "oxlint-disable import/extensions",
  };
  const metadata = {
    program: { body: [], hashbang },
    comments: [
      { start: lineStart, end: source.indexOf("\r"), type: "Line" },
      { start: blockStart, end: source.length, type: "Block" },
    ],
  };
  expect(readStaticSourceTransfer(metadata, source, "a.js")?.comments.map((c) => c.value)).toEqual([
    hashbang.value,
    " 日本語🌟",
    " oxlint-disable no-restricted-imports ",
  ]);
  expect(readStaticSourceTransfer(metadata, source, "a.ts")?.comments.map((c) => c.value)).toEqual([
    " 日本語🌟",
    " oxlint-disable no-restricted-imports ",
  ]);
});

test("unknown static names, import kind or comment shapes request eager fallback", () => {
  const base = {
    type: "ImportDeclaration",
    start: 0,
    source: { value: "pkg" },
    importKind: "value",
  };
  for (const node of [
    { ...base, specifiers: "invalid" },
    { ...base, importKind: "unsupported", specifiers: [] },
    {
      ...base,
      specifiers: [
        { type: "ImportSpecifier", importKind: "value", imported: { type: "Unknown", name: "x" } },
      ],
    },
  ]) {
    expect(
      readStaticSourceTransfer({ program: { body: [node] }, comments: [] }, "", "a.js"),
    ).toBeUndefined();
  }
  expect(
    readStaticSourceTransfer(
      {
        program: { body: [] },
        comments: [{ start: 0, end: 0, type: "Unknown" }],
      },
      "",
      "a.js",
    ),
  ).toBeUndefined();
  expect(
    readStaticSourceTransfer(
      { program: { body: [{ type: "ImportFutureDeclaration" }] }, comments: [] },
      "",
      "a.js",
    ),
  ).toBeUndefined();
});
