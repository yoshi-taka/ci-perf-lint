import { test } from "bun:test";
import fc from "fast-check";
import { compareDocumentConversion } from "./yaml-document-test-helpers.ts";

const numeric = fc
  .tuple(
    fc.constantFrom("", "+", "-"),
    fc.nat(9999999),
    fc.nat(999),
    fc.constantFrom("integer", "decimal", "exponent", "hex", "binary", "octal", "time"),
  )
  .map(([sign, whole, fraction, kind]) => {
    if (kind === "decimal") {
      return `${sign}${whole}.${String(fraction).padStart(3, "0")}`;
    }
    if (kind === "exponent") {
      return `${sign}${whole}e${fraction - 500}`;
    }
    if (kind === "hex") {
      return `${sign}0x${whole.toString(16)}`;
    }
    if (kind === "binary") {
      return `${sign}0b${whole.toString(2)}`;
    }
    if (kind === "octal") {
      return `${sign}0${whole.toString(8)}`;
    }
    if (kind === "time") {
      return `${sign}${whole}:${fraction % 60}`;
    }
    return `${sign}${whole}`;
  });
const tagged = fc
  .tuple(
    fc.constantFrom("str", "null", "bool", "int", "float", "timestamp", "binary"),
    fc.oneof(
      numeric,
      fc.string({ maxLength: 24 }),
      fc.constantFrom("", "true", "yes", ".NaN", "aGVsbG8=", "2026-11-07"),
    ),
  )
  .map(([tag, text]) => `!!${tag} ${JSON.stringify(text)}`);

for (let batch = 0; batch < 5; batch++) {
  test(`fuzz: owned scalar callbacks in nested documents (batch ${batch + 1})`, () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(numeric, tagged), { maxLength: 8 }),
        fc.constantFrom("1.1", "1.2"),
        (items, version) => {
          compareDocumentConversion(
            `%YAML ${version}\n---\nvalues: [${items.join(", ")}]\n? [${items.join(", ")}]\n: output`,
          );
        },
      ),
      { numRuns: 100, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true },
    );
  });
}
