import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LineCounter,
  YAMLMap,
  parseDocument,
  isMap,
  isNode,
  isScalar,
  isSeq,
} from "../src/yaml.ts";

describe("YAML compatibility boundary", () => {
  test("production does not import the external YAML parser", () => {
    const root = path.resolve(import.meta.dir, "../src");
    const directImports = [];
    const dependencyImport = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']yaml["']/;
    for (const file of new Bun.Glob("**/*.ts").scanSync({ cwd: root, onlyFiles: true })) {
      if (dependencyImport.test(readFileSync(path.join(root, file), "utf8"))) {
        directImports.push(file);
      }
    }
    expect(directImports).toEqual([]);
  });

  test("maps, pairs, sequences, scalars and conversion preserve source order", () => {
    const document = parseDocument('name: "CI"\non: [push, pull_request]\njobs: {}\n');
    expect(document.errors).toEqual([]);
    const root = document.contents;
    expect(isNode(root)).toBe(true);
    if (!isMap(root)) {
      throw new Error("Expected mapping");
    }
    expect(root.items.map((pair) => (isScalar(pair.key) ? pair.key.value : undefined))).toEqual([
      "name",
      "on",
      "jobs",
    ]);
    expect(isScalar(root.items[0]?.value)).toBe(true);
    expect(isSeq(root.items[1]?.value)).toBe(true);
    expect(isMap(root.items[2]?.value)).toBe(true);
    expect(root.toJSON()).toEqual({ name: "CI", on: ["push", "pull_request"], jobs: {} });
    expect(document.toJS()).toEqual(root.toJSON());
    expect(isNode({ value: "not an AST node" })).toBe(false);
    expect(isMap({ items: [] })).toBe(false);
  });

  test("CircleCI can create synthetic empty map nodes and assign source ranges", () => {
    const node = new YAMLMap<unknown, unknown>();
    node.range = [0, 0, 0];
    expect(isNode(node)).toBe(true);
    expect(isMap(node)).toBe(true);
    expect(node.items).toEqual([]);
    expect(node.range).toEqual([0, 0, 0]);
    expect(node.toJSON()).toEqual({});
  });

  test("default core schema leaves on/yes/no as strings, not YAML 1.1 booleans", () => {
    expect(
      parseDocument(
        "on: yes\nno: off\ntruth: true\nfalsehood: FALSE\nempty:\nnullValue: ~\ninteger: 42\nhex: 0x2a\nquoted: '42'\n",
      ).toJS(),
    ).toEqual({
      on: "yes",
      no: "off",
      truth: true,
      falsehood: false,
      empty: null,
      nullValue: null,
      integer: 42,
      hex: 42,
      quoted: "42",
    });
  });

  test("explicit YAML 1.1 directives retain the existing schema behavior", () => {
    const document = parseDocument("%YAML 1.1\n---\non: yes\n");
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toEqual({ true: true });
  });

  test.each([
    ["|", "first\nsecond\n"],
    ["|-", "first\nsecond"],
    ["|+", "first\nsecond\n\n"],
    [">", "first second\n"],
    [">-", "first second"],
    [">+", "first second\n\n"],
  ])("block scalar %s preserves folding and chomping", (indicator, expected) => {
    const source = `run: ${indicator}\n  first\n  second\n${indicator.endsWith("+") ? "\n" : ""}`;
    expect(parseDocument(source).toJS()).toEqual({ run: expected });
  });

  test("block scalar explicit indentation preserves more-indented shell content", () => {
    expect(parseDocument("run: |2-\n  first\n    indented\n\nnext: done\n").toJS()).toEqual({
      run: "first\n  indented",
      next: "done",
    });
  });

  test("CRLF and Unicode retain UTF-16 source offsets and line/column positions", () => {
    const source = 'emoji: 🌟\r\njobs:\r\n  build:\r\n    run: "echo done" # tail\r\n';
    const lineCounter = new LineCounter();
    const document = parseDocument(source, {
      lineCounter,
      keepSourceTokens: true,
      prettyErrors: true,
    });
    if (!isMap(document.contents)) {
      throw new Error("Expected mapping");
    }
    const jobs = document.contents.items[1]?.value;
    if (!isMap(jobs)) {
      throw new Error("Expected jobs mapping");
    }
    const build = jobs.items[0]?.value;
    if (!isMap(build)) {
      throw new Error("Expected job mapping");
    }
    const run = build.items[0]?.value;
    if (!isScalar(run)) {
      throw new Error("Expected run scalar");
    }
    expect(run.range[0]).toBe(source.indexOf('"echo done"'));
    expect(lineCounter.linePos(run.range[0])).toEqual({ line: 4, col: 10 });
    const flowSource = 'values: ["🌟", "text"]';
    const flowCounter = new LineCounter();
    const flow = parseDocument(flowSource, { lineCounter: flowCounter });
    if (!isMap(flow.contents) || !isSeq(flow.contents.items[0]?.value)) {
      throw new Error("Expected sequence");
    }
    const value = flow.contents.items[0].value.items[1];
    if (!isScalar(value)) {
      throw new Error("Expected scalar");
    }
    expect(value.range[0]).toBe(flowSource.indexOf('"text"'));
    expect(flowCounter.linePos(value.range[0])).toEqual({ line: 1, col: 16 });
  });

  test("document alias resolution and node-only conversion keep their distinct existing contracts", () => {
    const document = parseDocument("base: &base {run: echo ok}\ncopy: *base\n");
    const value = document.toJS() as { base: unknown; copy: unknown };
    expect(value).toEqual({ base: { run: "echo ok" }, copy: { run: "echo ok" } });
    expect(value.copy).toBe(value.base);
    // Current callers use node.toJSON too. Do not silently change alias behavior
    // as part of a parser replacement; any semantic fix needs its own change.
    expect(document.contents?.toJSON()).toEqual({
      base: { run: "echo ok" },
      copy: { source: "base" },
    });
    expect(() => document.toJS({ maxAliasCount: 0 })).toThrow(ReferenceError);
  });

  test("cyclic aliases retain shared identity without eager expansion", () => {
    const document = parseDocument("list: &list [*list]\n");
    const value = document.toJS() as { list: unknown[] };
    expect(value.list[0]).toBe(value.list);
  });

  test("unresolved aliases fail at document conversion, not by fabricating a value", () => {
    const document = parseDocument("copy: *missing\n");
    expect(document.errors).toEqual([]);
    expect(() => document.toJS()).toThrow("Unresolved alias");
  });

  test("default merge keys remain literal keys rather than applying YAML 1.1 merging", () => {
    expect(parseDocument("base: &base {x: 1}\ncopy: {<<: *base, y: 2}\n").toJS()).toEqual({
      base: { x: 1 },
      copy: { "<<": { x: 1 }, y: 2 },
    });
  });

  test("GitLab custom reference tags remain sequences with a resolution warning", () => {
    const document = parseDocument("script: !reference [.base, script]\n");
    expect(document.errors).toEqual([]);
    expect(document.warnings.map((warning) => warning.code)).toEqual(["TAG_RESOLVE_FAILED"]);
    expect(document.toJS()).toEqual({ script: [".base", "script"] });
  });

  test("duplicate keys and multiple documents remain document errors", () => {
    const duplicate = parseDocument("key: first\nkey: second\n");
    expect(duplicate.errors.map((error) => error.code)).toContain("DUPLICATE_KEY");
    expect(duplicate.errors[0]?.pos[0]).toBe(11);
    expect(
      parseDocument("key: first\n---\nkey: second\n").errors.map((error) => error.code),
    ).toContain("MULTIPLE_DOCS");
  });

  test("prototype-looking YAML keys stay own data properties", () => {
    const document = parseDocument("__proto__: {marker: data}\nconstructor: preserved\n");
    const value = document.toJS() as Record<string, unknown>;
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toEqual({ marker: "data" });
    expect(Object.getOwnPropertyDescriptor(value, "constructor")?.value).toBe("preserved");
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });
});
