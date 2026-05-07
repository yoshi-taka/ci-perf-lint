import { describe, expect, test } from "bun:test";
import { hashContent } from "../src/hash.ts";

describe("hashContent", () => {
  test("produces deterministic output for same input", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("")).toBe(hashContent(""));
    expect(hashContent("a".repeat(1000))).toBe(hashContent("a".repeat(1000)));
  });

  test("produces different hashes for different inputs", () => {
    expect(hashContent("foo")).not.toBe(hashContent("bar"));
  });

  test("detects length-preserving edits", () => {
    const a = "npm run build";
    const b = "bun run bildd";
    expect(a.length).toBe(b.length);
    expect(hashContent(a)).not.toBe(hashContent(b));
  });

  test("detects single character changes", () => {
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
    expect(hashContent("abc")).not.toBe(hashContent("abb"));
  });

  test("handles empty string", () => {
    const h = hashContent("");
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(0);
  });

  test("handles large input without throwing", () => {
    const large = "x".repeat(100_000);
    expect(() => hashContent(large)).not.toThrow();
    expect(hashContent(large).length).toBeLessThan(20);
  });

  test("returns base-36 string", () => {
    const h = hashContent("anything");
    expect(h).toMatch(/^[0-9a-z]+$/);
  });

  test("same length but different content produces different hashes", () => {
    const inputs = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i).repeat(10));
    const hashes = inputs.map(hashContent);
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });
});
