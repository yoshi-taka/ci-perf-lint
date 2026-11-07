import { expect, test } from "bun:test";
import fc from "fast-check";
import { foldFlowLines } from "yaml/util";
import { foldKeyLines } from "../src/yaml-key-folding.ts";

test("fuzz: flow/quoted key folding matches native boundaries and escape handling", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.oneof(
          fc.string({ maxLength: 15 }),
          fc.constantFrom(
            " ",
            "  ",
            "\n",
            "\t",
            "\\n",
            "\\x41",
            "\\u1234",
            "\\U0001f600",
            '\\"',
            "\\\\",
          ),
        ),
        { maxLength: 40 },
      ),
      fc.integer({ min: 0, max: 15 }),
      fc.boolean(),
      fc.record({
        lineWidth: fc.integer({ min: -1, max: 100 }),
        minContentWidth: fc.integer({ min: 0, max: 25 }),
        indentAtStart: fc.option(fc.integer({ min: -20, max: 120 }), { nil: undefined }),
      }),
      (parts, width, quoted, options) => {
        const text = parts.join("");
        const indent = " ".repeat(width);
        expect(foldKeyLines(text, indent, quoted, options)).toBe(
          foldFlowLines(text, indent, quoted ? "quoted" : "flow", options),
        );
      },
    ),
    { numRuns: 1000, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true },
  );
});
