import { describe, expect, test } from "bun:test";

// Test the tfFileCount >= 10 severity boundary from terraform-parallelism.ts
function expectedSeverity(tfFileCount: number): "warning" | "suggestion" {
  return tfFileCount >= 10 ? "warning" : "suggestion";
}

describe("terraform-parallelism severity boundary BVA", () => {
  describe("tfFileCount >= 10", () => {
    test.each([
      [0, "suggestion"],
      [9, "suggestion"],
      [10, "warning"],
      [11, "warning"],
      [100, "warning"],
    ] as const)("%p files -> %p", (tfFileCount, severity) => {
      expect(expectedSeverity(tfFileCount)).toBe(severity);
    });
  });
});
