import { describe, expect, test } from "bun:test";
import { applyOps } from "../src/rules/shared/diagnostic-ops.ts";
import type { Diagnostic } from "../src/types.ts";

function makeDiagnostic(overrides?: Partial<Diagnostic>): Diagnostic {
  return {
    ruleId: "test-rule",
    severity: "warning",
    confidence: "high",
    docsPath: "docs/rules/test-rule.md",
    workflow: ".github/workflows/ci.yml",
    location: { path: "test.ts", line: 1, column: 1 },
    message: "Test diagnostic",
    why: "Because testing matters.",
    suggestion: "Write more tests.",
    measurementHint: "Run the test suite.",
    aiHandoff: "Review test coverage.",
    score: 50,
    ...overrides,
  };
}

describe("DiagnosticOp applyOps", () => {
  test("setSeverity changes severity", () => {
    const d = makeDiagnostic({ severity: "warning" });
    const result = applyOps(d, [{ op: "setSeverity", severity: "suggestion" }]);
    expect(result.severity).toBe("suggestion");
  });

  test("setScore overrides score", () => {
    const d = makeDiagnostic({ score: 50 });
    const result = applyOps(d, [{ op: "setScore", score: 92 }]);
    expect(result.score).toBe(92);
  });

  test("adjustScore adds delta", () => {
    const d = makeDiagnostic({ score: 50 });
    const result = applyOps(d, [{ op: "adjustScore", delta: 10 }]);
    expect(result.score).toBe(60);
  });

  test("adjustScore with negative delta", () => {
    const d = makeDiagnostic({ score: 50 });
    const result = applyOps(d, [{ op: "adjustScore", delta: -15 }]);
    expect(result.score).toBe(35);
  });

  test("augmentWhy appends text", () => {
    const d = makeDiagnostic({ why: "Original reason." });
    const result = applyOps(d, [{ op: "augmentWhy", text: "Additional context." }]);
    expect(result.why).toBe("Original reason.\nAdditional context.");
  });

  test("augmentWhy prepends text", () => {
    const d = makeDiagnostic({ why: "Original reason." });
    const result = applyOps(d, [{ op: "augmentWhy", text: "Prefix.", position: "prepend" }]);
    expect(result.why).toBe("Prefix.\nOriginal reason.");
  });

  test("multiple ops compose in order", () => {
    const d = makeDiagnostic({ severity: "warning", score: 50, why: "Base." });
    const result = applyOps(d, [
      { op: "setSeverity", severity: "suggestion" },
      { op: "setScore", score: 36 },
      { op: "augmentWhy", text: "Added." },
    ]);
    expect(result.severity).toBe("suggestion");
    expect(result.score).toBe(36);
    expect(result.why).toBe("Base.\nAdded.");
  });

  test("conditional then branch", () => {
    const d = makeDiagnostic({ score: 90 });
    const result = applyOps(d, [
      {
        op: "conditional",
        predicate: (diag) => diag.score > 50,
        then: [{ op: "setSeverity", severity: "warning" }],
        else: [{ op: "setSeverity", severity: "suggestion" }],
      },
    ]);
    expect(result.severity).toBe("warning");
  });

  test("conditional else branch", () => {
    const d = makeDiagnostic({ score: 30 });
    const result = applyOps(d, [
      {
        op: "conditional",
        predicate: (diag) => diag.score > 50,
        then: [{ op: "setSeverity", severity: "warning" }],
        else: [{ op: "setSeverity", severity: "suggestion" }],
      },
    ]);
    expect(result.severity).toBe("suggestion");
  });

  test("conditional without else", () => {
    const d = makeDiagnostic({ score: 30 });
    const result = applyOps(d, [
      {
        op: "conditional",
        predicate: (diag) => diag.score > 50,
        then: [{ op: "setScore", score: 99 }],
      },
    ]);
    expect(result.score).toBe(30);
  });

  test("nested conditional", () => {
    const d = makeDiagnostic({ score: 70, severity: "warning" });
    const result = applyOps(d, [
      {
        op: "conditional",
        predicate: (diag) => diag.score > 50,
        then: [
          {
            op: "conditional",
            predicate: (diag) => diag.severity === "warning",
            then: [{ op: "setScore", score: 45 }],
          },
        ],
      },
    ]);
    expect(result.score).toBe(45);
  });

  test("empty ops returns diagnostic unchanged", () => {
    const d = makeDiagnostic({ score: 50, severity: "warning", why: "Test." });
    const result = applyOps(d, []);
    expect(result.score).toBe(50);
    expect(result.severity).toBe("warning");
    expect(result.why).toBe("Test.");
  });
});
