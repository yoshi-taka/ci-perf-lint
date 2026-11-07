import { describe, expect, test } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import { parseDocument } from "../src/yaml.ts";
import { compareDocumentConversion, captureYamlWarnings } from "./yaml-document-test-helpers.ts";

function valueOf(source: string): unknown {
  return captureYamlWarnings(() => referenceParse(source).toJS()).result;
}

describe("quoted scalar escapes and folding", () => {
  // YAML 1.2.2 specification 5.7 / 7.3.1 / 7.3.2.
  const escapes: [string, string][] = [
    ["\\0", "\0"],
    ["\\a", "\x07"],
    ["\\b", "\b"],
    ["\\t", "\t"],
    ["\\n", "\n"],
    ["\\v", "\v"],
    ["\\f", "\f"],
    ["\\r", "\r"],
    ["\\e", "\x1b"],
    ["\\ ", " "],
    ['\\"', '"'],
    ["\\/", "/"],
    ["\\\\", "\\"],
    ["\\N", "\u0085"],
    ["\\_", "\u00a0"],
    ["\\L", "\u2028"],
    ["\\P", "\u2029"],
    ["\\x41", "A"],
    ["\\u263A", "☺"],
    ["\\U0001F600", "😀"],
  ];

  test.each(escapes)("double-quoted escape %s", (escape, expected) => {
    const source = `value: "${escape}"\n`;
    expect(valueOf(source)).toEqual({ value: expected });
    expect(parseDocument(source).toJS()).toEqual({ value: expected });
    compareDocumentConversion(source);
  });

  test.each([
    '"first\n  second"',
    '"first\n\n  second"',
    '"first\\\n  second"',
    '"first  \n  second"',
    '"first\t\n  second"',
    "'first\n  second'",
    "'first\n\n  second'",
    "'it''s'",
    '"\\x41\\u263A\\U0001F600"',
  ])("quoted scalar folding %s", (quoted) => {
    const source = `value: ${quoted}\n`;
    expect(parseDocument(source).toJS()).toEqual(valueOf(source));
    compareDocumentConversion(source);
  });

  test.each([
    ["plain folding", "value: first\n  second\n"],
    ["plain blank line", "value: first\n\n  second\n"],
    ["plain more indented", "value: first\n    indented\n  second\n"],
    ["plain comment", "value: first # comment\n"],
    ["plain tab continuation", "value: first\n  \tsecond\n"],
  ])("%s", (_name, source) => {
    expect(parseDocument(source).toJS()).toEqual(valueOf(source));
    compareDocumentConversion(source);
  });

  test.each([
    ['value: "\\q"\n', "unknown escape"],
    ['value: "\\x1"\n', "short hex escape"],
    ['value: "\\u12"\n', "short unicode escape"],
    ['value: "\\U0001"\n', "short long unicode escape"],
  ])("invalid escape %s", (source, _name) => {
    expect(parseDocument(source).errors.length).toBeGreaterThan(0);
    compareDocumentConversion(source);
  });
});
