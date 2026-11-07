import { describe, expect, test } from "bun:test";
import { parseDocument as nativeParse } from "yaml";
import { parseDocument } from "../src/yaml.ts";

describe("YAML parser robustness", () => {
  test("deeply unclosed flow input is diagnosed without escaping the boundary", () => {
    const source = "[".repeat(20_000);
    const document = parseDocument(source);
    expect(document.errors.length).toBeGreaterThan(0);
    expect(() => document.toJS()).not.toThrow();
  }, 20_000);

  test("deep but closed flow input is parsed", () => {
    const depth = 5_000;
    const source = "[".repeat(depth) + "]".repeat(depth);
    const document = parseDocument(source);
    expect(document.errors).toEqual([]);
    expect(Array.isArray(document.toJS())).toBe(true);
  }, 20_000);

  test("large plain scalars and truncated quotes terminate", () => {
    const large = `a: ${"x".repeat(1024 * 1024)}`;
    expect(parseDocument(large).toJS()).toEqual({ a: "x".repeat(1024 * 1024) });
    const truncated = `"${"a".repeat(50_000)}`;
    expect(parseDocument(truncated).errors.length).toBeGreaterThan(0);
  }, 20_000);

  test("control characters and lone surrogates do not crash parsing", () => {
    for (const source of ["a: \0\0\0\nb: \u0001", 'a: "\uD800"']) {
      const document = parseDocument(source);
      const reference = nativeParse(source);
      expect(document.errors.map((error) => error.code)).toEqual(
        reference.errors.map((error) => error.code),
      );
      expect(document.toJS()).toEqual(reference.toJS());
    }
  });

  test("excessive alias expansion remains limited during conversion", () => {
    const chains = Array.from({ length: 2_000 }, (_, index) => {
      const previous = index === 0 ? "a" : `b${index - 1}`;
      return `b${index}: &b${index} [${Array.from({ length: 9 }, () => `*${previous}`).join(",")}]`;
    });
    const source = `a: &a [1,2,3,4,5,6,7,8,9]\n${chains.join("\n")}`;
    const document = parseDocument(source);
    expect(document.errors).toEqual([]);
    expect(() => document.toJS()).toThrow();
  }, 20_000);

  test("many distinct keys stay linear enough to finish", () => {
    const source = Array.from({ length: 5_000 }, (_, index) => `k${index}: ${index}`).join("\n");
    const started = performance.now();
    const document = parseDocument(source);
    expect(document.errors).toEqual([]);
    expect(Object.keys(document.toJS() as Record<string, unknown>)).toHaveLength(5_000);
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 20_000);
});
