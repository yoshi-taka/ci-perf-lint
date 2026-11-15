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
  expect(transferred?.references).toEqual([
    { start: 0, source: "./setup", names: [], runtime: true, namespace: false, wildcard: false },
    {
      start: 1,
      source: "pkg",
      names: ["format"],
      runtime: true,
      namespace: false,
      wildcard: false,
    },
    { start: 2, source: "pkg", names: ["local"], runtime: true, namespace: false, wildcard: false },
    { start: 3, source: "pkg", names: [], runtime: false, namespace: false, wildcard: true },
  ]);
  imported.name = "changed";
  expect(transferred?.references[1]?.names).toEqual(["format"]);
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

test("flat references retain empty names, namespaces and type-only distinctions", () => {
  const metadata = {
    comments: [],
    program: {
      body: [
        {
          type: "ImportDeclaration",
          start: 0,
          source: { value: "pkg" },
          importKind: "value",
          specifiers: [
            { type: "ImportDefaultSpecifier" },
            { type: "ImportNamespaceSpecifier" },
            {
              type: "ImportSpecifier",
              importKind: "value",
              imported: { type: "StringLiteral", value: "" },
            },
            {
              type: "ImportSpecifier",
              importKind: "type",
              imported: { type: "IdentifierName", name: "Type" },
            },
          ],
        },
        {
          type: "ImportDeclaration",
          start: 1,
          source: { value: "pkg" },
          importKind: "type",
          specifiers: [{ type: "ImportNamespaceSpecifier" }],
        },
        {
          type: "ExportFromDeclaration",
          start: 2,
          source: { value: "pkg" },
          exportKind: "value",
          specifiers: [{ exportKind: "value", local: { type: "StringLiteral", value: "" } }],
        },
      ],
    },
  };
  const result = readStaticSourceTransfer(metadata, "", "a.ts");
  expect(result?.references).toEqual([
    {
      start: 0,
      source: "pkg",
      names: ["default", ""],
      namespace: true,
      runtime: true,
      wildcard: false,
    },
    { start: 1, source: "pkg", names: [], namespace: false, runtime: false, wildcard: false },
    { start: 2, source: "pkg", names: [""], namespace: false, runtime: true, wildcard: false },
  ]);
  expect(result?.references[0]?.names).not.toBe(result?.references[1]?.names);
});

test("unknown names in type-only specifiers still request fallback", () => {
  for (const importKind of ["type", "value"]) {
    expect(
      readStaticSourceTransfer(
        {
          program: {
            body: [
              {
                type: "ImportDeclaration",
                start: 0,
                source: { value: "pkg" },
                importKind,
                specifiers: [
                  { type: "ImportSpecifier", importKind: "type", imported: { type: "Unknown" } },
                ],
              },
            ],
          },
          comments: [],
        },
        "",
        "a.ts",
      ),
    ).toBeUndefined();
  }
});
