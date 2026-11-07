import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  parseDocument as referenceParse,
  stringify as referenceStringify,
  isMap as referenceIsMap,
  isScalar as referenceIsScalar,
  isSeq as referenceIsSeq,
} from "yaml";
import { parseDocument, LineCounter, isMap, isScalar, isSeq } from "../src/yaml.ts";

// The external parser is deliberately a test-only oracle here. Stage 1 still
// delegates to it; these comparisons become independent when the backend changes.
// Do not import the candidate's serializer to generate the model's expected values.
const options = { numRuns: 500, interruptAfterTimeLimit: 10000 };
type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
function valueArbitrary(depth: number): fc.Arbitrary<Value> {
  const scalar = fc.oneof(
    fc.string({ maxLength: 40 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
  );
  if (depth === 0) {
    return scalar;
  }
  return fc.oneof(
    scalar,
    fc.array(valueArbitrary(depth - 1), { maxLength: 5 }),
    fc.dictionary(
      fc.oneof(
        fc.string({ maxLength: 20 }),
        fc.constantFrom("on", "yes", "__proto__", "constructor"),
      ),
      valueArbitrary(depth - 1),
      { maxKeys: 5 },
    ),
  );
}

function astProjection(node: unknown): unknown {
  if (isMap(node) || referenceIsMap(node)) {
    return {
      kind: "map",
      range: node.range,
      items: node.items.map((pair) => ({
        key: astProjection(pair.key),
        value: astProjection(pair.value),
      })),
    };
  }
  if (isSeq(node) || referenceIsSeq(node)) {
    return { kind: "seq", range: node.range, items: node.items.map(astProjection) };
  }
  if (isScalar(node) || referenceIsScalar(node)) {
    return {
      kind: "scalar",
      range: node.range,
      value: node.value,
      type: node.type,
      comment: node.comment,
      commentBefore: node.commentBefore,
    };
  }
  return node;
}

describe("fuzz: YAML replacement compatibility contract", () => {
  test("generated values retain decoded values and the AST/range projection", () => {
    fc.assert(
      fc.property(valueArbitrary(2), fc.constantFrom("block", "json"), (value, style) => {
        const source = style === "block" ? referenceStringify(value) : JSON.stringify(value);
        const reference = referenceParse(source);
        const candidate = parseDocument(source);
        expect(reference.errors).toEqual([]);
        expect(candidate.errors).toEqual([]);
        expect(candidate.toJS()).toEqual(value);
        expect(candidate.contents?.toJSON()).toEqual(reference.contents?.toJSON());
        expect(candidate.toJSON()).toEqual(reference.toJSON());
        expect(astProjection(candidate.contents)).toEqual(astProjection(reference.contents));
      }),
      options,
    );
  });

  test("duplicate-key mutations cannot become valid input", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (value) => {
        const source = `{"run":${JSON.stringify(value)},"run":"second"}`;
        expect(referenceParse(source).errors.map((error) => error.code)).toContain("DUPLICATE_KEY");
        expect(parseDocument(source).errors.map((error) => error.code)).toContain("DUPLICATE_KEY");
      }),
      options,
    );
  });

  test("comment insertion and LF/CRLF preserve scalar locations in original source", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 30 }), { maxLength: 12 }),
        fc.string({ maxLength: 60 }),
        fc.constantFrom("\n", "\r\n"),
        (comments, value, newline) => {
          const lines = comments.map(
            (line) => `# note ${line.replaceAll("\n", " ").replaceAll("\r", " ")}`,
          );
          lines.push(`value: ${JSON.stringify(value)}`);
          const source = lines.join(newline);
          const counter = new LineCounter();
          const document = parseDocument(source, { lineCounter: counter });
          expect(document.errors).toEqual([]);
          if (!isMap(document.contents)) {
            throw new Error("Expected mapping");
          }
          const node = document.contents.items[0]?.value;
          if (!isScalar(node)) {
            throw new Error("Expected scalar");
          }
          expect(node.value).toBe(value);
          expect(node.range[0]).toBe(source.lastIndexOf("value: ") + 7);
          expect(counter.linePos(node.range[0])).toEqual({ line: comments.length + 1, col: 8 });
        },
      ),
      options,
    );
  });
});
