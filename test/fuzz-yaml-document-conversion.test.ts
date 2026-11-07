import { describe, test } from "bun:test";
import fc from "fast-check";
import { compareDocumentConversion } from "./yaml-document-test-helpers.ts";

const entry = fc.record({
  anchor: fc.integer({ min: 0, max: 5 }),
  kind: fc.constantFrom("scalar", "seq", "map"),
  value: fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean(), fc.constant(null)),
  references: fc.array(fc.integer({ min: 0, max: 7 }), { maxLength: 5 }),
});

describe("fuzz: owned YAML document conversion", () => {
  for (const valid of [false, true]) {
    // Keep all 500 runs per grammar without exceeding Bun's per-test budget
    // when the full repository suite competes for parallel worker time.
    for (let batch = 0; batch < 5; batch++) {
      test(`${
        valid
          ? "resolved graphs retain cycles and shared identity"
          : "redefinitions and dangling aliases retain resolution/errors"
      } (batch ${batch + 1})`, () => {
        fc.assert(
          fc.property(fc.array(entry, { minLength: 1, maxLength: 15 }), (entries) => {
            const source = entries
              .map((item, index) => {
                // A second grammar guarantees all aliases resolve, including self-cycles.
                // The first grammar also covers forward/missing/redefined anchors.
                const refs = item.references.map((id) => `*a${valid ? id % (index + 1) : id}`);
                const value =
                  item.kind === "scalar"
                    ? JSON.stringify(item.value)
                    : item.kind === "seq"
                      ? `[${refs.join(", ")}]`
                      : `{value: ${JSON.stringify(item.value)}, refs: [${refs.join(", ")}]}`;
                return `- &a${valid ? index : item.anchor} ${value}`;
              })
              .join("\n");
            compareDocumentConversion(source, [-1, 0, 1, 2, 10, 100]);
          }),
          { numRuns: 100, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true },
        );
      });
    }
  }
});
