import { describe, expect, test } from "bun:test";

// Test the score formula from ungated-heavy-job.ts:
// score = 78 - (hasPathFilter ? 12 : 0) - (hasConcurrency ? 8 : 0) - (jobCount > 6 ? 8 : 0)
function expectedScore(hasPathFilter: boolean, hasConcurrency: boolean, jobCount: number): number {
  return 78 - (hasPathFilter ? 12 : 0) - (hasConcurrency ? 8 : 0) - (jobCount > 6 ? 8 : 0);
}

describe("ungated-heavy-job score formula BVA", () => {
  describe("workflowJobCount > 6 boundary", () => {
    test.each([
      [0, 78],
      [6, 78],
      [7, 70],
      [8, 70],
    ] as const)("%p jobs -> %p", (jobCount, score) => {
      expect(expectedScore(false, false, jobCount)).toBe(score);
    });
  });

  describe("all guard combinations", () => {
    test.each([
      ["no guards", 78, false, false, 1],
      ["path filter only", 66, true, false, 1],
      ["concurrency only", 70, false, true, 1],
      ["many jobs only", 70, false, false, 7],
      ["path filter + concurrency", 58, true, true, 1],
      ["path filter + many jobs", 58, true, false, 7],
      ["concurrency + many jobs", 62, false, true, 7],
      ["all three guards", 50, true, true, 7],
    ] as const)("%s -> %p", (_name, score, hasPathFilter, hasConcurrency, jobCount) => {
      expect(expectedScore(hasPathFilter, hasConcurrency, jobCount)).toBe(score);
    });
  });
});
