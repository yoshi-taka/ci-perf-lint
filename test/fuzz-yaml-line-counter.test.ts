import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { LineCounter as ReferenceLineCounter } from "yaml";
import { LineCounter } from "../src/yaml.ts";

describe("fuzz: owned YAML line counter", () => {
  test("sorted starts and arbitrary offsets match the original counter", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 2000 }), { maxLength: 100 }),
        fc.array(fc.integer({ min: -10, max: 2200 }), { minLength: 1, maxLength: 30 }),
        (generated, offsets) => {
          const counter = new LineCounter();
          const reference = new ReferenceLineCounter();
          for (const start of generated.sort((left, right) => left - right)) {
            expect(counter.addNewLine(start)).toBe(reference.addNewLine(start));
          }
          const lookup = counter.linePos;
          expect(counter.lineStarts).toEqual(reference.lineStarts);
          for (const offset of offsets) {
            expect(lookup(offset)).toEqual(reference.linePos(offset));
          }
        },
      ),
      { numRuns: 500, interruptAfterTimeLimit: 10000 },
    );
  });
});
