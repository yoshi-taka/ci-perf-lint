import { describe, expect, test } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import { parseDocument } from "../src/yaml.ts";
import { compareDocumentConversion, captureYamlWarnings } from "./yaml-document-test-helpers.ts";

function valueOf(source: string): unknown {
  return captureYamlWarnings(() => referenceParse(source).toJS()).result;
}

describe("YAML spec examples for consumed constructs", () => {
  // YAML 1.2.2 specification examples 8.1-8.10 / productions
  // l-literal-content, l-folded-content, c-b-block-header.
  test.each([
    ["clip", "key: |\n  first\n  second\n", { key: "first\nsecond\n" }],
    ["strip", "key: |-\n  first\n  second\n", { key: "first\nsecond" }],
    ["keep", "key: |+\n  first\n  second\n\n", { key: "first\nsecond\n\n" }],
    ["folded clip", "key: >\n  first\n  second\n", { key: "first second\n" }],
    ["folded strip", "key: >-\n  first\n  second\n", { key: "first second" }],
    ["folded keep", "key: >+\n  first\n  second\n\n", { key: "first second\n\n" }],
    ["explicit indentation", "key: |2-\n    more\n  base\n", { key: "  more\nbase" }],
    ["root literal", "--- |\n  root\n", "root\n"],
    ["empty literal", "key: |\n", { key: "" }],
    ["header comment", "key: | # comment\n  text\n", { key: "text\n" }],
    [
      "folded more-indented",
      "key: >\n  folded\n    indented\n  next\n",
      { key: "folded\n  indented\nnext\n" },
    ],
    ["literal blank lines", "key: |\n  first\n\n  second\n", { key: "first\n\nsecond\n" }],
  ])("block scalar %s", (_name, source, expected) => {
    expect(valueOf(source)).toEqual(expected);
    expect(parseDocument(source).toJS()).toEqual(expected);
    compareDocumentConversion(source);
  });

  // Specification examples 7.1-7.5 / flow productions.
  test.each([
    ["nested flow", "value: [{a: 1}, [2, {b: [3]}]]\n"],
    ["flow explicit key", "value: {? a: b}\n"],
    ["flow empty value", "value: {a: , b: 2}\n"],
    ["flow comments", "value: [one, # comment\n  two]\n"],
    ["flow multiline", "value: {a: 1,\n  b: [2,\n    3]}\n"],
    ["json subset", '{"a": [1, 2, {"b": null}], "c": true}\n'],
    ["ordered map syntax", "value: [a: 1, b: 2]\n"],
  ])("flow collections: %s", (_name, source) => {
    compareDocumentConversion(source);
  });

  // Specification examples 2.9-2.10, 2.23-2.25 and anchor productions.
  test.each([
    ["anchor scalar", "a: &x value\nb: *x\n"],
    ["anchor collection", "base: &base {a: 1}\ncopy: *base\n"],
    ["redefined anchor", "a: &x one\nb: &x two\nc: *x\n"],
    ["anchor on key", "&k key: value\n"],
    ["cyclic alias", "list: &list [*list]\n"],
    ["verbatim tag", "value: !<tag:example.org,2026:item> data\n"],
    ["local tag", "value: !custom data\n"],
    ["secondary tag", "value: !!str 123\n"],
    ["tag directive", "%TAG !e! tag:example.org,2026:\n---\nvalue: !e!item data\n"],
    ["secondary handle override", "%TAG !! tag:example.org,2026:\n---\nvalue: !!item data\n"],
    ["reference tag", "script: !reference [.base, script]\n"],
    ["percent tag suffix", "%TAG !e! tag:example.org,2026:\n---\nvalue: !e!with%20space data\n"],
  ])("node properties: %s", (_name, source) => {
    compareDocumentConversion(source);
  });

  test.each([
    ["explicit document", "---\nkey: value\n"],
    ["document end", "---\nkey: value\n...\n"],
    ["document end comment", "---\nkey: value\n... # end\n"],
    ["empty document", "---\n"],
    ["bare document", "key: value\n"],
    ["bom document", "\uFEFF---\nkey: value\n"],
  ])("document markers: %s", (_name, source) => {
    compareDocumentConversion(source);
  });

  test("multi-document streams keep the first document and report MULTIPLE_DOCS", () => {
    const source = "---\nfirst: 1\n---\nsecond: 2\n";
    const document = parseDocument(source);
    expect(document.errors.map((error) => error.code)).toContain("MULTIPLE_DOCS");
    expect(document.toJS()).toEqual({ first: 1 });
  });
});

describe("YAML character and line-break productions", () => {
  // Specification 5.4, 5.5, 5.7 and 6.5.
  test.each([
    ["crlf", "a: one\r\nb: two\r\n"],
    ["nel", "a: one\u0085b: two\n"],
    ["line separator", "a: one\u2028b: two\n"],
    ["paragraph separator", "a: one\u2029b: two\n"],
    ["tab in scalar", "a: one\ttwo\n"],
    ["unicode text", "emoji: 🌟\n"],
    ["non-breaking space", "a: one\u00A0two\n"],
  ])("characters: %s", (_name, source) => {
    compareDocumentConversion(source);
  });

  test.each([
    ["tab indentation", "a:\n\tb: 1\n"],
    ["unclosed flow sequence", "a: [one, two\n"],
    ["unclosed flow mapping", "a: {one: two\n"],
    ["missing colon value", "a: b: c\n"],
    ["duplicate key", "a: 1\na: 2\n"],
    ["bad directive", "%BAD value\n---\na: 1\n"],
    ["invalid yaml version", "%YAML 1.3\n---\na: 1\n"],
    ["inline sequence indicator after value", "key: -\n"],
    ["comment without separation", 'value: "a"# c\n'],
    ["tab indentation after comment", "value: # c\n  \t:\n"],
    ["quote colon continuation", 'value: a\n  ":\n'],
    ["tab indicator after value", "value: \t-\n   #\n"],
  ])("selected invalid stream: %s", (_name, source) => {
    const document = parseDocument(source);
    expect(document.errors.length + document.warnings.length).toBeGreaterThan(0);
    compareDocumentConversion(source);
  });
});
