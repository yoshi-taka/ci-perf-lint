import { describe, expect, test } from "bun:test";
import { predicateToPrecheck } from "../src/rules/shared/predicate-score.ts";
import type { WeightedPredicate } from "../src/rules/shared/predicate-score.ts";
import { sourceContains, TRUE } from "../src/rules/shared/predicate.ts";

describe("predicateToPrecheck", () => {
  test("produces 1 for matching source", () => {
    const wps: WeightedPredicate[] = [
      { pred: sourceContains("npm run"), weight: 1, label: "has-npm-run" },
    ];
    const precheck = predicateToPrecheck(wps);
    expect(precheck({ source: "steps:\n  - run: npm run build\n" })).toBe(1);
  });

  test("produces 0 for non-matching source", () => {
    const wps: WeightedPredicate[] = [
      { pred: sourceContains("npm run"), weight: 1, label: "has-npm-run" },
    ];
    const precheck = predicateToPrecheck(wps);
    expect(precheck({ source: "steps:\n  - run: echo hello\n" })).toBe(0);
  });

  test("matches original prefer-node-run-over-npm-run behavior", () => {
    const wps: WeightedPredicate[] = [
      { pred: sourceContains("npm run"), weight: 1, label: "has-npm-run" },
    ];
    const precheck = predicateToPrecheck(wps);
    expect(precheck({ source: "steps:\n  - run: npm run build\n" })).toBe(1);
    expect(precheck({ source: "steps:\n  - run: echo hello\n" })).toBe(0);
  });

  test("multiple weighted predicates sum scores", () => {
    const wps: WeightedPredicate[] = [
      { pred: sourceContains("npm"), weight: 2, label: "has-npm" },
      { pred: sourceContains("run"), weight: 1, label: "has-run" },
    ];
    const precheck = predicateToPrecheck(wps);
    expect(precheck({ source: "npm install\nnpm run build" })).toBe(3);
    expect(precheck({ source: "only run" })).toBe(1);
  });
});
