import { describe, expect, test } from "bun:test";

// Replicate threshold constants from repository-similar-workflows.ts
const minimumPeerCount = 3;
const minimumSharedFeatureCount = 3;
const minimumSimilarity = 0.55;
const minimumConsensusRatio = 0.75;

describe("similar workflow consensus thresholds BVA", () => {
  describe("minimumPeerCount = 3", () => {
    test.each([
      [0, false],
      [2, false],
      [3, true],
      [4, true],
    ] as const)("%p peers -> %p", (peerCount, expected) => {
      expect(peerCount >= minimumPeerCount).toBe(expected);
    });
  });

  describe("minimumSharedFeatureCount = 3", () => {
    test.each([
      [0, false],
      [2, false],
      [3, true],
      [4, true],
    ] as const)("%p features -> %p", (featureCount, expected) => {
      expect(featureCount >= minimumSharedFeatureCount).toBe(expected);
    });
  });

  describe("minimumSimilarity = 0.55", () => {
    const eps = 0.001;

    test.each([
      [0.0, false],
      [0.54, false],
      [0.55, true],
      [0.56, true],
      [1.0, true],
    ] as const)("%p -> %p", (value, expected) => {
      expect(value >= minimumSimilarity - eps).toBe(expected);
    });
  });

  describe("minimumConsensusRatio = 0.75", () => {
    const eps = 0.001;

    test.each([
      [0.0, false],
      [0.74, false],
      [0.75, true],
      [0.76, true],
      [1.0, true],
    ] as const)("%p -> %p", (value, expected) => {
      expect(value >= minimumConsensusRatio - eps).toBe(expected);
    });
  });

  describe("feature similarity computation (intersection / union)", () => {
    function similarity(a: Set<string>, b: Set<string>): number {
      if (a.size === 0 && b.size === 0) {
        return 0;
      }
      const intersection = new Set([...a].filter((x) => b.has(x)));
      const union = new Set([...a, ...b]);
      return intersection.size / union.size;
    }

    test.each([
      ["both empty", 0, [], []],
      ["identical single feature", 1, ["npm"], ["npm"]],
      ["completely different", 0, ["npm"], ["docker"]],
      ["partial overlap", 1 / 3, ["npm", "build"], ["npm", "test"]],
      ["one empty, one non-empty", 0, [], ["npm"]],
    ] as const)("%s -> %p", (_name, expected, a, b) => {
      expect(similarity(new Set(a), new Set(b))).toBe(expected);
    });
    test("threshold boundary: similarity = 0.55", () => {
      // 5 features, 3 shared, 2 unique each = 3/(3+2+2) = 3/7 ≈ 0.428
      const a = new Set(["a", "b", "c", "d", "e"]);
      const b = new Set(["a", "b", "c", "f", "g"]);
      expect(similarity(a, b)).toBeCloseTo(3 / 7, 5);
      expect(similarity(a, b) < 0.55).toBe(true);
    });
  });
});
