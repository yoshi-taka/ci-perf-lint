import { describe, expect, test } from "bun:test";
import type { Severity } from "../src/types.ts";
import { joinSeverity, severityCompare } from "../src/severity.ts";

describe("joinSeverity", () => {
  test("picks the stronger severity", () => {
    expect(joinSeverity("suggestion", "warning")).toBe("warning");
    expect(joinSeverity("warning", "error")).toBe("error");
    expect(joinSeverity("error", "suggestion")).toBe("error");
    expect(joinSeverity("warning", "suggestion")).toBe("warning");
    expect(joinSeverity("error", "warning")).toBe("error");
  });

  test("idempotent", () => {
    expect(joinSeverity("suggestion", "suggestion")).toBe("suggestion");
    expect(joinSeverity("warning", "warning")).toBe("warning");
    expect(joinSeverity("error", "error")).toBe("error");
  });

  test("commutative", () => {
    const pairs: [Severity, Severity][] = [
      ["suggestion", "warning"],
      ["warning", "error"],
      ["suggestion", "error"],
    ];
    for (const [a, b] of pairs) {
      expect(joinSeverity(a, b)).toBe(joinSeverity(b, a));
    }
  });

  test("associative", () => {
    const r1 = joinSeverity(joinSeverity("suggestion", "warning"), "error");
    const r2 = joinSeverity("suggestion", joinSeverity("warning", "error"));
    expect(r1).toBe(r2);
    expect(r1).toBe("error");
  });
});

describe("severityCompare", () => {
  test("equal severities", () => {
    expect(severityCompare("suggestion", "suggestion")).toBe(0);
    expect(severityCompare("warning", "warning")).toBe(0);
    expect(severityCompare("error", "error")).toBe(0);
  });

  test("lesser severity is negative", () => {
    expect(severityCompare("suggestion", "warning")).toBeLessThan(0);
    expect(severityCompare("warning", "error")).toBeLessThan(0);
  });

  test("greater severity is positive", () => {
    expect(severityCompare("warning", "suggestion")).toBeGreaterThan(0);
    expect(severityCompare("error", "warning")).toBeGreaterThan(0);
  });
});
