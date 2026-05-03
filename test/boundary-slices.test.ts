import { describe, expect, test } from "bun:test";

function sliceResult<T>(items: T[], limit: number): { visible: T[]; remaining: number } {
  const visible = items.slice(0, limit);
  return { visible, remaining: items.length - visible.length };
}

describe("slice boundary patterns (applied throughout codebase)", () => {
  describe(".slice(0, 3) pattern (precedents, suggestions)", () => {
    test.each([
      [0, 0, 0],
      [1, 1, 0],
      [2, 2, 0],
      [3, 3, 0],
      [4, 3, 1],
      [10, 3, 7],
    ] as const)("%p items -> %p visible, %p remaining", (itemCount, visible, remaining) => {
      const r = sliceResult(
        Array.from({ length: itemCount }, (_, i) => `${i}`),
        3,
      );
      expect(r.visible).toHaveLength(visible);
      expect(r.remaining).toBe(remaining);
    });
  });

  describe(".slice(0, 5) pattern (locations, evidence)", () => {
    test.each([
      [0, 0, 0],
      [4, 4, 0],
      [5, 5, 0],
      [6, 5, 1],
    ] as const)("%p items -> %p visible, %p remaining", (itemCount, visible, remaining) => {
      const r = sliceResult(
        Array.from({ length: itemCount }, (_, i) => `${i}`),
        5,
      );
      expect(r.visible).toHaveLength(visible);
      expect(r.remaining).toBe(remaining);
    });
  });

  describe(".slice(0, 6) pattern (similar flags)", () => {
    test.each([
      [5, 5, 0],
      [6, 6, 0],
      [7, 6, 1],
    ] as const)("%p items -> %p visible, %p remaining", (itemCount, visible, remaining) => {
      const r = sliceResult(
        Array.from({ length: itemCount }, (_, i) => `${i}`),
        6,
      );
      expect(r.visible).toHaveLength(visible);
      expect(r.remaining).toBe(remaining);
    });
  });

  describe(".slice(0, 10) pattern (similar workflow peers)", () => {
    test.each([
      [9, 9, 0],
      [10, 10, 0],
      [11, 10, 1],
    ] as const)("%p items -> %p visible, %p remaining", (itemCount, visible, remaining) => {
      const r = sliceResult(
        Array.from({ length: itemCount }, (_, i) => `${i}`),
        10,
      );
      expect(r.visible).toHaveLength(visible);
      expect(r.remaining).toBe(remaining);
    });
  });

  describe("topCount parameterized (0, 1, N)", () => {
    test.each([
      [0, ["a", "b", "c"], []],
      [1, ["a", "b", "c"], ["a"]],
      [100, ["a", "b"], ["a", "b"]],
    ] as const)("topCount=%p", (limit, items, visible) => {
      expect(sliceResult([...items], limit).visible).toEqual([...visible]);
    });
  });
});
