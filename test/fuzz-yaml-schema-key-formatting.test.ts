import { test } from "bun:test";
import fc from "fast-check";
import { compareDocumentConversion } from "./yaml-document-test-helpers.ts";

const atom = fc.constantFrom(
  "yes",
  "NO",
  "On",
  "off",
  "y",
  "N",
  "012",
  "-012",
  "0b1010",
  "1_000",
  "1:20",
  "123:45:56.120",
  "1.200",
  "1e3",
  "!!str yes",
  "!!str true",
  "!!int '42'",
  "!!float 1.0",
  "!!bool false",
  "!!merge '<<'",
  "!!binary aGVsbG8=",
  "!!timestamp 2026-11-07",
  "!custom value",
  "!e!item yes",
  "!e!punct%2Citem value",
  "!!str [one]",
  "!!binary [one]",
  "!!set {one: not-null}",
  "!!omap {first: one}",
);

for (let batch = 0; batch < 5; batch++) {
  test(`fuzz: schemas, tags, directive spelling and special collection keys (batch ${batch + 1})`, () => {
    fc.assert(
      fc.property(
        fc.array(atom, { maxLength: 5 }),
        fc.constantFrom("1.1", "1.2"),
        fc.constantFrom("seq", "map", "omap", "pairs", "tagged"),
        (items, version, shape) => {
          const pairs = items.map((value, index) => `{${JSON.stringify(`key${index}`)}: ${value}}`);
          const body =
            shape === "seq"
              ? `[${items.join(", ")}]`
              : shape === "map"
                ? `{${items.map((value, index) => `${JSON.stringify(`key${index}`)}: ${value}`).join(", ")}}`
                : shape === "omap" || shape === "pairs"
                  ? `!!${shape} [${pairs.join(", ")}]`
                  : `!e!thing [${items.join(", ")}]`;
          compareDocumentConversion(
            `%YAML ${version}\n%TAG !e! tag:example.org,2026:\n---\n? ${body}\n: output`,
          );
        },
      ),
      { numRuns: 100, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true },
    );
  });
}
