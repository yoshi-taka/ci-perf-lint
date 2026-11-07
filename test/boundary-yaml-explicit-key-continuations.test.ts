import { describe, expect, test } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import { parseDocument } from "../src/yaml.ts";
import { captureYamlWarnings } from "./yaml-document-test-helpers.ts";

// Regression matrix for plain-scalar continuation lines: these combinations
// previously produced false diagnostics on valid YAML (explicit keys, empty
// keys and sequence indicators on following lines). Invalid-input presence is
// covered by the dedicated boundary corpora; this matrix guards valid input.
// Cases are chunked so thousands of checks do not register thousands of tests.
const prefixes = ["", " ", "  ", "\t", " \t"];
const tokens = [":", ": x", "?", "? x", "-", "- x", "'", '"', "#", "# c", "'x", "'x:", "a"];
const sources = new Set<string>();
for (const first of prefixes) {
  for (const firstToken of tokens) {
    for (const second of ["", "  ", "   ", "\t"]) {
      for (const secondToken of tokens) {
        sources.add(`value: a\n${first}${firstToken}\n${second}${secondToken}\n`);
        sources.add(`value: a\n${first}${firstToken}\n${second}${secondToken}: x\n`);
      }
    }
  }
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function validFailures(inputs: Iterable<string>): unknown[] {
  const failures: unknown[] = [];
  for (const source of inputs) {
    const reference = referenceParse(source);
    if (reference.errors.length > 0 || reference.warnings.length > 0) {
      // Malformed cases are outside this property; other corpora cover them.
      continue;
    }
    const candidate = parseDocument(source);
    const errors = candidate.errors.map((error) => error.code);
    const warnings = candidate.warnings.map((warning) => warning.code);
    if (errors.length > 0 || warnings.length > 0) {
      failures.push({ source, errors, warnings });
      continue;
    }
    // Compare structurally: collection-valued keys stringify differently in
    // warning text, which is covered by dedicated formatting tests.
    const expected = captureYamlWarnings(() => reference.toJS({ mapAsMap: true })).result;
    const actual = captureYamlWarnings(() => candidate.toJS({ mapAsMap: true })).result;
    if (!Bun.deepEquals(actual, expected)) {
      failures.push({ source, expected, actual });
    }
  }
  return failures;
}

describe("plain scalar continuation lines", () => {
  test.each(chunked([...sources], 250).map((chunk, index) => ({ index, chunk })))(
    "valid continuation chunk %# does not become a diagnostic",
    ({ chunk }) => {
      expect(validFailures(chunk)).toEqual([]);
    },
  );

  test("CI regression: quote continuation followed by a comment line stays scalar", () => {
    const source = "value: a\n   '\n   #':\n";
    const candidate = parseDocument(source);
    expect(candidate.errors).toEqual([]);
    expect(candidate.toJS()).toEqual({ value: "a '" });
  });

  test.each([
    "value: a\n: x\n   ? x\n",
    "value: a\n?\n:: x\n",
    "value: a\n?\n: x: x\n",
    "value: a\n? x\n- x\n",
    "value: a\n?\n-\n",
  ])("explicit key/indicator continuation: %s", (source) => {
    expect(referenceParse(source).errors).toEqual([]);
    const candidate = parseDocument(source);
    expect(candidate.errors).toEqual([]);
    expect(candidate.toJS({ mapAsMap: true })).toEqual(
      referenceParse(source).toJS({ mapAsMap: true }),
    );
  });
});

const quotedSuffixSources = new Set<string>();
for (const prefix of ["value: ", "value: \t", "- "]) {
  for (const quoted of ['"a"', "'a b'"]) {
    for (const suffix of ["#", "# c", ",", "]", "}", ":", ": x", " # c"]) {
      quotedSuffixSources.add(`${prefix}${quoted}${suffix}\n`);
      quotedSuffixSources.add(`${prefix}${quoted}${suffix}\nnext: true\n`);
    }
  }
}

const commentIndentSources = new Set<string>();
for (const comment of ["value: # c\n", "value: #\n", "value: a # c\n"]) {
  for (const prefix of ["", " ", "  ", "\t", " \t"]) {
    for (const token of [":", ": x", "-", "- x", "?", "? x", "a: x"]) {
      commentIndentSources.add(`${comment}${prefix}${token}\n`);
      commentIndentSources.add(`${comment}${prefix}${token}\n  a\n`);
    }
  }
}

const quotedKeySources = new Set<string>();
for (const key of ['"a:b"', "'a:b'", '"husky@npm:^9.0.0"', '"a:b:c"', '"a#b:c"']) {
  for (const value of ["value", "{}", "[]", ""]) {
    quotedKeySources.add(`${key}: ${value}\n`);
    quotedKeySources.add(`outer:\n  ${key}: ${value}\n`);
  }
}

describe("provisional diagnostic acceptance matrices", () => {
  test.each(
    chunked(
      [
        ["quoted scalar suffix", quotedSuffixSources],
        ["comment-indented continuation", commentIndentSources],
        ["quoted key", quotedKeySources],
      ] as const,
      50,
    ).map((chunk, index) => ({ index, chunk })),
  )("acceptance chunk %# stays valid", ({ chunk }) => {
    const inputs = chunk.flatMap(([, set]) => [...set]);
    expect(validFailures(inputs)).toEqual([]);
  });
});
