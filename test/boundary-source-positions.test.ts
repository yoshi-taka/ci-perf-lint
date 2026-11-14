import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { sourcePositions } from "../src/repository-diagnostics/source-audit-parser.ts";

/** The previous character scan, independent of the bulk-search implementation. */
function referencePositions(source: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "\r") {
      if (source[index + 1] === "\n") {
        index++;
      }
      starts.push(index + 1);
    } else if (character === "\n" || character === "\u2028" || character === "\u2029") {
      starts.push(index + 1);
    }
  }
  return (offset) => {
    // Linear lookup also checks that the production binary search remains equivalent.
    let line = 0;
    for (let index = 1; index < starts.length && starts[index]! <= offset; index++) {
      line = index;
    }
    return { line: line + 1, column: offset - starts[line]! + 1 };
  };
}

describe("source position bulk search", () => {
  test("preserves newline boundaries, CRLF midpoints and UTF-16 columns", () => {
    for (const source of [
      "",
      "ordinary ASCII",
      "🌟é\uD800\uDC00",
      "\n\n",
      "\r\r",
      "\r\n\r\n",
      "a\r\nb\rc\nd\u2028e\u2029🌟",
      "\n\r\n\r\u2028\u2029",
    ]) {
      const position = sourcePositions(source);
      const reference = referencePositions(source);
      const offsets = [NaN, Infinity, -Infinity];
      for (let offset = -2; offset <= source.length + 2; offset += 0.5) {
        offsets.push(offset);
      }
      for (const offset of offsets.reverse()) {
        expect(position(offset)).toEqual(reference(offset));
      }
    }
  });

  test("LF-only and mixed inputs match the previous scan for arbitrary queries", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            "abc",
            "🌟",
            "é",
            "\uD800",
            "\uDC00",
            "\r",
            "\n",
            "\r\n",
            "\u2028",
            "\u2029",
          ),
          { maxLength: 200 },
        ),
        fc.array(fc.integer({ min: -20, max: 1500 }), { maxLength: 50 }),
        (parts, offsets) => {
          const mixed = parts.join("");
          for (const source of [mixed, mixed.replace(/[\r\u2028\u2029]/g, "")]) {
            const position = sourcePositions(source);
            const reference = referencePositions(source);
            for (const offset of offsets) {
              expect(position(offset / 2)).toEqual(reference(offset / 2));
            }
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("lookups from separate sources remain independent across repeated calls", () => {
    const first = sourcePositions("🌟\r\nx\u2028");
    const second = sourcePositions("a\nb\n");
    const third = sourcePositions("\r\n");
    for (let iteration = 0; iteration < 3; iteration++) {
      expect(first(4)).toEqual({ line: 2, column: 1 });
      expect(first(6)).toEqual({ line: 3, column: 1 });
      expect(second(4)).toEqual({ line: 3, column: 1 });
      expect(third(1)).toEqual({ line: 1, column: 2 });
      expect(third(2)).toEqual({ line: 2, column: 1 });
    }
  });
});
