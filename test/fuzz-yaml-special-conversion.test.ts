import { describe, test } from "bun:test";
import fc from "fast-check";
import { compareDocumentConversion } from "./yaml-document-test-helpers.ts";

const scalar = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);
const key = fc.constantFrom("first", "second", "__proto__", "constructor", "toString", "on", "1");
const mapping = fc.dictionary(key, fc.oneof(scalar, fc.array(scalar, { maxLength: 3 })), {
  maxKeys: 5,
});
const options = { numRuns: 100, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true };

describe("fuzz: owned special YAML conversion", () => {
  for (let batch = 0; batch < 5; batch++) {
    test(`merge precedence, schema and alias limits (batch ${batch + 1})`, () => {
      fc.assert(
        fc.property(
          fc.array(mapping, { minLength: 1, maxLength: 5 }),
          mapping,
          fc.array(fc.nat({ max: 20 }), { maxLength: 5 }),
          fc.constantFrom("sequence", "sequence-alias", "direct-alias", "inline"),
          fc.record({ first: fc.boolean(), yaml11: fc.boolean() }),
          (sources, explicit, indices, style, { first, yaml11 }) => {
            const refs = indices.map((index) => `*src${index % sources.length}`);
            const merge =
              style === "sequence-alias"
                ? "*chain"
                : style === "direct-alias"
                  ? "*src0"
                  : style === "inline"
                    ? JSON.stringify(sources[0])
                    : `[${refs.join(", ")}]`;
            const pairs = Object.entries(explicit).map(
              ([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`,
            );
            const merged = `!!merge <<: ${merge}`;
            const body = first ? [...pairs, merged] : [merged, ...pairs];
            const source = `${yaml11 ? "%YAML 1.1\n---\n" : ""}sources: [${sources.map((value, index) => `&src${index} ${JSON.stringify(value)}`).join(", ")}]\nchain: &chain [${refs.join(", ")}]\nresult: {${body.join(", ")}}`;
            compareDocumentConversion(source, [-1, 0, 1, 2, 100]);
          },
        ),
        options,
      );
    });

    test(`set/pairs/omap duplicates, cycles and malformed values (batch ${batch + 1})`, () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({ key, value: scalar, self: fc.boolean() }), { maxLength: 8 }),
          fc.constantFrom("set", "pairs", "omap"),
          fc.boolean(),
          fc.boolean(),
          (entries, tag, invalidSet, yaml11) => {
            const pairs = entries.map(
              (item) =>
                `${JSON.stringify(item.key)}: ${tag === "set" && !invalidSet ? "null" : item.self ? "*tagged" : JSON.stringify(item.value)}`,
            );
            const value =
              tag === "set"
                ? `{${pairs.join(", ")}}`
                : `[${pairs.map((pair) => `{${pair}}`).join(", ")}]`;
            const source = `${yaml11 ? "%YAML 1.1\n---\n" : ""}- &tagged !!${tag} ${value}\n- *tagged\n`;
            compareDocumentConversion(source, [-1, 0, 1, 2, 100]);
          },
        ),
        options,
      );
    });
  }
});
