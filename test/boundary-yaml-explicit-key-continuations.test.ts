import { describe, expect, test } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import { parseDocument } from "../src/yaml.ts";
import { captureYamlWarnings } from "./yaml-document-test-helpers.ts";

// Regression matrix for plain-scalar continuation lines: these combinations
// previously produced false diagnostics on valid YAML (explicit keys, empty
// keys and sequence indicators on following lines). Invalid-input presence is
// covered by the dedicated boundary corpora; this matrix guards valid input.
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

describe("plain scalar continuation lines", () => {
  test.each([...sources].map((source, index) => ({ index, source })))(
    "valid continuation %# does not become a diagnostic",
    ({ source }) => {
      const reference = referenceParse(source);
      if (reference.errors.length > 0 || reference.warnings.length > 0) {
        // Malformed cases are outside this property; other corpora cover them.
        return;
      }
      const candidate = parseDocument(source);
      expect({ source, errors: candidate.errors.map((error) => error.code) }).toEqual({
        source,
        errors: [],
      });
      expect({ source, warnings: candidate.warnings.map((warning) => warning.code) }).toEqual({
        source,
        warnings: [],
      });
      // Compare structurally: collection-valued keys stringify differently in
      // warning text, which is covered by dedicated formatting tests.
      const expected = captureYamlWarnings(() => reference.toJS({ mapAsMap: true })).result;
      const actual = captureYamlWarnings(() => candidate.toJS({ mapAsMap: true })).result;
      expect({ source, value: actual }).toEqual({ source, value: expected });
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
