import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDocument, isMap, isSeq, isScalar } from "../src/yaml.ts";
import { formatComplexKey } from "../src/yaml-key-stringifier.ts";
import { parseDocument as referenceParse } from "yaml";
import {
  compareDocumentConversion as compare,
  captureYamlWarnings,
} from "./yaml-document-test-helpers.ts";

describe("owned YAML complex-key conversion", () => {
  test("the parser boundary never delegates whole-document JS/JSON conversion", () => {
    const source = readFileSync(new URL("../src/yaml.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bdocument\.to(?:JS|JSON)\s*\(/);
    expect(source).not.toMatch(/\b(?:document|native)\.(?:toString|createNode)\s*\(/);
    expect(source).not.toMatch(
      /\b(?:templates|compatibilityKey|ExternalScalar|ExternalAlias|ExternalPair)\b/,
    );
  });

  // Actual upstream tests/doc/parse.ts 'handling complex keys' and
  // 'Excessive entity expansion attacks', v2.8.1. Not just spec prose examples.
  // https://github.com/eemeli/yaml/blob/v2.8.1/tests/doc/parse.ts
  test("upstream collection-key regression retains exact key and process warning", () => {
    const document = parseDocument("[foo]: bar");
    const { result, warnings } = captureYamlWarnings(() => document.toJS());
    expect(result).toEqual({ "[ foo ]": "bar" });
    expect(warnings).toEqual([
      'Keys with collection values will be stringified due to JS Object restrictions: "[ foo ]". Set mapAsMap: true to use object keys.',
    ]);
    expect(document.warnings).toEqual([]);
    expect(captureYamlWarnings(() => document.toJS({ mapAsMap: true }))).toEqual({
      result: new Map([[["foo"], "bar"]]),
      warnings: [],
    });
    compare("[foo]: bar");
    compare("[ [foo]: bar ]");
  });

  test("one warning per conversion; repeated calls do not share warning state", () => {
    const document = parseDocument("[first]: one\n[second]: two\n");
    for (const run of [() => document.toJS(), () => document.toJS(), () => document.toJSON()]) {
      expect(captureYamlWarnings(run).warnings).toHaveLength(1);
    }
    compare("[first]: one\n[second]: two\n");
  });

  test("short core flow keys are formatted independently, without the compatibility adapter", () => {
    const node = parseDocument('[first, {second: "two"}, [null, TRUE, 42]]').contents;
    if (!node) {
      throw new Error("Expected sequence");
    }
    expect(formatComplexKey(node, [])).toBe('[ first, { second: "two" }, [ null, TRUE, 42 ] ]');
  });

  test.each([
    "[0x2a, 0o17, 1.200, 1e3, -0, .nan, .inf]",
    "[one, # inline\n two]",
    "[one,\n # before\n two]",
    "{first: # key comment\n value, second: other}",
    "{first:\n # value comment\n value, second: other}",
    "{ ? [one, two] : value }",
    "[&a [first], *a]",
    "&root [*root]",
    '["\\0\\a\\x1b\\u2028\\u2029"]',
    `["${"long ".repeat(30).trim()}"]`,
    `[${"long ".repeat(30).trim()}]`,
    '["line\\n'.concat("long ".repeat(15), '"]'),
  ])("numeric, comment, escape and width output needs no compatibility formatter: %s", (body) => {
    const source = `? ${body}\n: value`;
    const document = parseDocument(source);
    if (!isMap(document.contents)) {
      throw new Error("Expected mapping");
    }
    const node = document.contents.items[0]?.key;
    if (!node) {
      throw new Error("Expected complex key");
    }
    const expected = captureYamlWarnings(() => referenceParse(source).toJS()).result as Record<
      string,
      unknown
    >;
    expect(formatComplexKey(node, [node])).toBe(Object.keys(expected)[0]!);
    compare(source);
  });

  test("complex-key conversion observes owned mutations instead of a native document snapshot", () => {
    const document = parseDocument("[first]: value");
    if (!isMap(document.contents)) {
      throw new Error("Expected mapping");
    }
    const key = document.contents.items[0]?.key;
    if (!isSeq(key) || !isScalar(key.items[0])) {
      throw new Error("Expected scalar in key");
    }
    key.items[0].value = "changed";
    expect(captureYamlWarnings(() => document.toJS()).result).toEqual({ "[ changed ]": "value" });
    expect(captureYamlWarnings(() => document.toJSON()).result).toEqual({ "[ changed ]": "value" });
  });

  test("owned formatting observes numeric metadata and comment mutations", () => {
    const document = parseDocument("[0x2a]: value");
    if (!isMap(document.contents)) {
      throw new Error("Expected mapping");
    }
    const key = document.contents.items[0]?.key;
    if (!isSeq(key) || !isScalar(key.items[0])) {
      throw new Error("Expected scalar in key");
    }
    key.items[0].value = 255;
    expect(captureYamlWarnings(() => document.toJS()).result).toEqual({ "[ 0xff ]": "value" });
    key.items[0].comment = " changed";
    expect(captureYamlWarnings(() => document.toJS()).result).toEqual({
      "[\n  0xff # changed\n]": "value",
    });
  });

  test.each([
    "[]: empty\n{}: map\n",
    "? {first: one, second: two}\n: value\n",
    "? {first, second}\n: value\n",
    "? {first: null, second: ~}\n: value\n",
    "? [{first: [one, two]}, {second: [3, 4]}]\n: value\n",
    "? { ? [one, two] : value }\n: nested\n",
    "[foo]: bar\nplain: {[nested]: value}\n",
    "? [one, # inline\n two]\n: value\n",
    "? [one,\n # before\n two]\n: value\n",
    "? [&a [one], *a]\n: value\n",
    `? [&a [one], "${"long ".repeat(30).trim()}", !custom value, *a]\n: value\n`,
    "? &a [*a]\n: value\n",
    "- &a [one, two]\n- {*a : value}\n",
    "- &a first\n- {*a : value}\n",
    "- {*missing : value}\n",
    "? [0x2a, 0o17, 1.200, 1e3, -0, .nan, .inf]\n: numbers\n",
    "? ['true', \"false\", null, ~, NULL, True, FALSE]\n: scalars\n",
    '? [!!str true, !!int "42"]\n: tags\n',
    "? [!!set {one, two}, !!omap [{one: two}]]\n: collections\n",
    "? !!timestamp 2026-11-06\n: date\n",
    "? !!binary aGVsbG8=\n: bytes\n",
    "- &date !!timestamp 2026-11-06\n- {*date : value}\n",
    "? [!custom one]\n: value\n",
    "%TAG !e! tag:example.com,2026:\n---\n? [!e!thing [one]]\n: value\n",
    "? ? !!binary ? !!binary\n",
    "? ? !!timestamp ? !!timestamp 2025-03-15T15:35:58.586Z\n",
    `[${"long ".repeat(30).trim()}]: value\n`,
    `["${"long ".repeat(30).trim()}"]: value\n`,
    '["line\\n'.concat("long ".repeat(15), '"]: value\n'),
    '["\\0\\a\\x1b\\u2028\\u2029"]: escaped\n',
    "%YAML 1.1\n---\n? [yes, no, 012, 1:20, .NaN]\n: legacy\n",
    // Minimized PBT regressions: commas participate in the 80-column decision.
    '? [{"on": "          "}, "       ", ["    ", "          ", "", []], first]\n: value\n',
    '? [{"first": [], "on": {"__proto__": "", "__proto__": second}}, "    \\"   "]\n: value\n',
  ])("keys, warnings, options, identity and errors remain compatible: %s", (source) => {
    compare(source, [-1, 0, 1, 2, 100]);
  });
});
