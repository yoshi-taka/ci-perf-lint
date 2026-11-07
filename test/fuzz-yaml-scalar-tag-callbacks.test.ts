import { expect, test } from "bun:test";
import { parseDocument as referenceParse, isScalar } from "yaml";
import fc from "fast-check";
import { resolveScalarTag } from "../src/yaml-scalar-resolve.ts";

for (const schema of ["core", "yaml-1.1"] as const) {
  test(`fuzz: scalar tag callbacks match independently observed ${schema} results`, () => {
    const document = referenceParse(schema === "core" ? "x" : "%YAML 1.1\n---\nx");
    const variants = new Map<string, number>();
    const descriptors = document.schema.tags.flatMap((tag) => {
      if (tag.collection || tag.tag === "tag:yaml.org,2002:merge") {
        return [];
      }
      const key = JSON.stringify([tag.tag, tag.format]);
      const variant = variants.get(key) ?? 0;
      variants.set(key, variant + 1);
      return [{ tag, input: { schema, tag: tag.tag, format: tag.format, variant } }];
    });
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 60 }),
          fc.integer().map(String),
          fc.double().map(String),
          fc.constantFrom("1.200", "-0.000", "yes", "aGVsbG8=", "2026-11-07T12:34:56.123+02:30"),
        ),
        fc.boolean(),
        (source, intAsBigInt) => {
          for (const { tag, input } of descriptors) {
            const nativeIssues: string[] = [];
            const ownedIssues: string[] = [];
            let expected: unknown;
            let actual: unknown;
            try {
              const result = tag.resolve(source, (message) => nativeIssues.push(message), {
                intAsBigInt,
              });
              expected = {
                value: isScalar(result) ? result.value : result,
                minFractionDigits: isScalar(result) ? result.minFractionDigits : undefined,
              };
            } catch (error) {
              if (!(error instanceof Error)) {
                throw error;
              }
              expected = { error: error.name, message: error.message };
            }
            try {
              const result = resolveScalarTag({ ...input, source, intAsBigInt }, (message) =>
                ownedIssues.push(message),
              );
              actual = { value: result.value, minFractionDigits: result.minFractionDigits };
            } catch (error) {
              if (!(error instanceof Error)) {
                throw error;
              }
              actual = { error: error.name, message: error.message };
            }
            expect({ actual, issues: ownedIssues }).toEqual({
              actual: expected,
              issues: nativeIssues,
            });
          }
        },
      ),
      { numRuns: 300, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true },
    );
  });
}
