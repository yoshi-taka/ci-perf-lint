import { expect, test } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import fc from "fast-check";
import { scalarTagTest } from "../src/yaml-scalar-tags.ts";

const token = fc.oneof(
  fc.string({ maxLength: 60 }),
  fc.integer().map(String),
  fc.double().map(String),
  fc
    .tuple(
      fc.constantFrom("", "+", "-"),
      fc.nat(999999),
      fc.nat(999),
      fc.constantFrom("decimal", "exponent", "time", "hex", "octal", "binary"),
    )
    .map(([sign, whole, part, kind]) => {
      if (kind === "decimal") {
        return `${sign}${whole}.${part}`;
      }
      if (kind === "exponent") {
        return `${sign}${whole}e${part - 500}`;
      }
      if (kind === "time") {
        return `${sign}${whole}:${part % 70}`;
      }
      if (kind === "hex") {
        return `${sign}0x${whole.toString(16)}`;
      }
      if (kind === "octal") {
        return `${sign}0${whole.toString(8)}`;
      }
      return `${sign}0b${whole.toString(2)}`;
    }),
  fc.constantFrom(
    "",
    "~",
    "null",
    "NULL",
    "nUlL",
    "true",
    "tRuE",
    "FALSE",
    "y",
    "yes",
    "NO",
    "on",
    "oN",
    "off",
    "1_2.0_0",
    "0x_",
    "0b_",
    "e3",
    ".e3",
    "<<",
    "2026-11-07",
    "2026-11-07T12:34:56+29",
    "2026-11-07T12:34:56-30",
  ),
);

for (const schema of ["core", "yaml-1.1"] as const) {
  test(`fuzz: independently owned scalar tag tests match ${schema} selections`, () => {
    const document = referenceParse(
      schema === "core"
        ? "[!!binary '', !!timestamp 2026-11-07, !!merge '<<']"
        : "%YAML 1.1\n---\nx",
    );
    const variants = new Map<string, number>();
    const records = document.schema.tags.flatMap((tag) => {
      if (tag.collection) {
        return [];
      }
      const key = JSON.stringify([tag.tag, tag.format]);
      const variant = variants.get(key) ?? 0;
      variants.set(key, variant + 1);
      return [
        {
          native: tag.test,
          owned: scalarTagTest({ schema, tag: tag.tag, format: tag.format, variant }),
        },
      ];
    });
    fc.assert(
      fc.property(
        token,
        fc.constantFrom("", " ", "\t", "\n", "\r\n", "\u2028", "\u2029", "_"),
        (source, suffix) => {
          for (const { native, owned } of records) {
            expect(owned === undefined).toBe(native === undefined);
            for (const value of [source, source + suffix, suffix + source]) {
              // Repeating a test on the same instance catches stateful patterns.
              expect(owned?.test(value)).toBe(native?.test(value));
              expect(owned?.test(value)).toBe(native?.test(value));
            }
          }
        },
      ),
      { numRuns: 500, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true },
    );
  });
}
