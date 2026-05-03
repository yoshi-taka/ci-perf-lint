import { describe, expect, test } from "bun:test";
import { estimateScheduleMinutes } from "../src/rules/scheduled-heavy-workflow-without-throttling.ts";

describe("estimateScheduleMinutes EP/BVA", () => {
  describe("parts.length < 5 → undefined", () => {
    test.each(["", "* * * *"] as const)("%p -> undefined", (schedule) => {
      expect(estimateScheduleMinutes(schedule)).toBeUndefined();
    });

    test("5 parts → proceeds (boundary)", () => {
      const result = estimateScheduleMinutes("0 0 * * *");
      expect(result).not.toBeUndefined();
    });
  });

  describe("minute/hour undefined → undefined", () => {
    test("empty minute field", () => {
      expect(estimateScheduleMinutes("  * * * *")).toBeUndefined();
    });
  });

  describe("minute = */N", () => {
    test.each([
      ["*/1 * * * *", 1],
      ["*/5 * * * *", 5],
      ["*/59 * * * *", 59],
      ["*/60 * * * *", 60],
    ] as const)("%p -> %p", (schedule, minutes) => {
      expect(estimateScheduleMinutes(schedule)).toBe(minutes);
    });
  });

  describe("minute = * and hour = *", () => {
    test("* * → 1", () => {
      expect(estimateScheduleMinutes("* * * * *")).toBe(1);
    });
  });

  describe("minute = digit and hour = *", () => {
    test.each(["0 * * * *", "30 * * * *"] as const)("%p -> 60", (schedule) => {
      expect(estimateScheduleMinutes(schedule)).toBe(60);
    });
  });

  describe("hour = */N", () => {
    test.each([
      ["0 */1 * * *", 60],
      ["0 */2 * * *", 120],
      ["0 */3 * * *", 180],
      ["0 */6 * * *", 360],
    ] as const)("%p -> %p", (schedule, minutes) => {
      expect(estimateScheduleMinutes(schedule)).toBe(minutes);
    });
  });

  describe("hour = comma-separated", () => {
    test.each([
      ["0 0,6 * * *", 360],
      ["0 9,17 * * *", 480],
      ["0 0,3,6 * * *", 180],
      ["0 0,2,4 * * *", 120],
    ] as const)("%p -> %p", (schedule, minutes) => {
      expect(estimateScheduleMinutes(schedule)).toBe(minutes);
    });
  });

  describe("minute = digit and hour = digit (daily)", () => {
    test.each(["0 0 * * *", "30 6 * * *"] as const)("%p -> 1440", (schedule) => {
      expect(estimateScheduleMinutes(schedule)).toBe(1440);
    });
  });

  describe("fallback → undefined", () => {
    test.each(["* 1-5 * * *", "* 0 * * 0", "* 1-2 1 * *"] as const)("%p -> 1", (schedule) => {
      expect(estimateScheduleMinutes(schedule)).toBe(1);
    });
  });

  describe("threshold boundary: 180 minutes", () => {
    test.each([
      ["0 */2 * * *", 120],
      ["0 */3 * * *", 180],
      ["0 0,3,6 * * *", 180],
      ["0 */4 * * *", 240],
    ] as const)("%p -> %p", (schedule, minutes) => {
      expect(estimateScheduleMinutes(schedule)).toBe(minutes);
    });
  });
});
