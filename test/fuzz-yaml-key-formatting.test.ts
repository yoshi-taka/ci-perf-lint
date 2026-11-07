import { describe, test } from "bun:test";
import fc from "fast-check";
import { compareDocumentConversion } from "./yaml-document-test-helpers.ts";

const literal = fc.oneof(
  fc.constantFrom(
    "first",
    "second",
    "null",
    "~",
    "TRUE",
    "False",
    "42",
    "-0",
    "0x2a",
    "0o17",
    "1.200",
    "1e3",
    ".nan",
    "!!str true",
    "!custom value",
    "{first, second}",
  ),
  fc.string({ maxLength: 90 }).map((value) => JSON.stringify(value)),
);

function flowSource(depth: number): fc.Arbitrary<string> {
  if (depth === 0) {
    return literal;
  }
  const child = flowSource(depth - 1);
  return fc.oneof(
    literal,
    fc.array(child, { maxLength: 4 }).map((items) => `[${items.join(", ")}]`),
    fc
      .array(fc.tuple(fc.constantFrom('"first"', '"second"', '"__proto__"', '"on"'), child), {
        maxLength: 3,
      })
      .map((entries) => `{${entries.map(([key, value]) => `${key}: ${value}`).join(", ")}}`),
  );
}

describe("fuzz: YAML complex-key conversion and formatting", () => {
  for (let batch = 0; batch < 5; batch++) {
    test(`nested flow keys preserve representation and warnings (batch ${batch + 1})`, () => {
      fc.assert(
        fc.property(fc.array(flowSource(2), { maxLength: 4 }), (items) => {
          const source = `? [${items.join(", ")}]\n: value\nplain: end\n`;
          compareDocumentConversion(source, [-1, 0, 1, 2, 100]);
        }),
        { numRuns: 100, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true },
      );
    });

    test(`annotations, legacy schema, width and alias keys match (batch ${batch + 1})`, () => {
      fc.assert(
        fc.property(
          flowSource(2),
          fc.string({ maxLength: 90 }),
          fc.boolean(),
          fc.constantFrom("comment", "anchor", "alias", "plain"),
          (child, text, legacy, style) => {
            const comment = text.replaceAll("\r", " ").replaceAll("\n", " ");
            const key =
              style === "comment"
                ? `[${child}, # ${comment}\n "second"]`
                : `[${child}, ${JSON.stringify(text)}]`;
            const prefix = legacy ? "%YAML 1.1\n---\n" : "";
            const source =
              style === "anchor"
                ? `${prefix}? &key [${child}, *key]\n: value\n`
                : style === "alias"
                  ? `${prefix}base: &key ${key}\n? *key\n: value\n`
                  : `${prefix}? ${key}\n: value\n`;
            compareDocumentConversion(source, [-1, 0, 1, 2, 100]);
          },
        ),
        { numRuns: 100, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true },
      );
    });
  }
});
