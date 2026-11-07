import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  parseDocument as referenceParse,
  isMap as referenceMap,
  isSeq as referenceSeq,
  isScalar as referenceScalar,
} from "yaml";
import { parseDocument, isMap, isSeq, isScalar } from "../src/yaml.ts";
import { formatComplexKey } from "../src/yaml-key-stringifier.ts";
import { captureYamlWarnings } from "./yaml-document-test-helpers.ts";

const value = fc
  .array(
    fc.oneof(
      fc.string({ maxLength: 12 }),
      fc.constantFrom(
        "\n",
        "\n\n",
        " \n",
        "\n ",
        "\t",
        "\0",
        "\x07",
        "\u0085",
        "\u00a0",
        "\u2028",
        "\u2029",
        "\ud800",
        "\udc00",
        "🌟",
        '"',
        "'",
        "\\",
      ),
    ),
    { maxLength: 20 },
  )
  .map((parts) => parts.join(""));

for (let batch = 0; batch < 5; batch++) {
  test(`fuzz: mutated key scalar quoting, Unicode and newline styles (batch ${batch + 1})`, () => {
    fc.assert(
      fc.property(
        value,
        fc.constantFrom("PLAIN", "QUOTE_SINGLE", "QUOTE_DOUBLE", "BLOCK_LITERAL", "BLOCK_FOLDED"),
        fc.boolean(),
        (text, style, sequence) => {
          const source = sequence
            ? '? ["placeholder"]\n: value'
            : '? {"placeholder": value}\n: value';
          const actual = parseDocument(source);
          const expected = referenceParse(source);
          if (!isMap(actual.contents) || !referenceMap(expected.contents)) {
            throw new Error("Expected mappings");
          }
          const key = actual.contents.items[0]?.key;
          const nativeKey = expected.contents.items[0]?.key;
          const scalar = isSeq(key) ? key.items[0] : isMap(key) ? key.items[0]?.key : undefined;
          const nativeScalar = referenceSeq(nativeKey)
            ? nativeKey.items[0]
            : referenceMap(nativeKey)
              ? nativeKey.items[0]?.key
              : undefined;
          if (!isScalar(scalar) || !referenceScalar(nativeScalar) || !key) {
            throw new Error("Expected scalar keys");
          }
          scalar.value = text;
          nativeScalar.value = text;
          scalar.type = style;
          nativeScalar.type = style;
          const reference = captureYamlWarnings(() => expected.toJS());
          expect(captureYamlWarnings(() => actual.toJS())).toEqual(reference);
          expect(formatComplexKey(key, [])).toBe(
            Object.keys(reference.result as Record<string, unknown>)[0]!,
          );
        },
      ),
      { numRuns: 100, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true },
    );
  });
}
