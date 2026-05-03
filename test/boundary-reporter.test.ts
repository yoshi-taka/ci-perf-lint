import { describe, expect, test } from "bun:test";
import {
  affectedLocationLimit,
  renderBacktickedListWithRemainder,
} from "../src/reporters-render.ts";

describe("affectedLocationLimit BVA", () => {
  test.each([
    [Number.POSITIVE_INFINITY, { showAllLocations: true }],
    [5, { showAllLocations: false }],
    [5, {}],
  ] as const)("returns %p for %p", (expected, options) => {
    expect(affectedLocationLimit(options)).toBe(expected);
  });
});

describe("renderBacktickedListWithRemainder EP/BVA", () => {
  test.each([
    [[], ""],
    [["a"], "`a`"],
    [["a", "b", "c", "d", "e"], "`a`, `b`, `c`, `d`, `e`"],
    [["a", "b", "c", "d", "e", "f"], "`a`, `b`, `c`, `d`, `e`, +1 more"],
    [["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], "`a`, `b`, `c`, `d`, `e`, +5 more"],
  ] as const)("%p -> %p", (items, expected) => {
    expect(renderBacktickedListWithRemainder([...items])).toBe(expected);
  });

  describe("custom limit parameter", () => {
    test.each([
      [0, ["a", "b"], "+2 more"],
      [1, ["a", "b"], "`a`, +1 more"],
      [3, ["a", "b", "c"], "`a`, `b`, `c`"],
      [3, ["a", "b", "c", "d"], "`a`, `b`, `c`, +1 more"],
    ] as const)("limit=%p items=%p", (limit, items, expected) => {
      expect(renderBacktickedListWithRemainder([...items], limit)).toBe(expected);
    });
  });
});
