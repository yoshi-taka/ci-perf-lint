import { describe, expect, test } from "bun:test";
import {
  isActionsFinding,
  findingIncludedInMode,
  promoteStrictFallbackSuggestions,
  applyLimitedActionsPriority,
  compareFindings,
} from "../src/repo-finding-utils.ts";
import type { Diagnostic } from "../src/types.ts";

function makeDiagnostic(
  overrides: Partial<Diagnostic> & { ruleId: string; workflow: string },
): Diagnostic {
  return {
    ruleId: overrides.ruleId,
    workflow: overrides.workflow,
    score: overrides.score ?? 50,
    severity: overrides.severity ?? "suggestion",
    scope: overrides.scope ?? "workflow",
    location: overrides.location ?? { path: "test.yml", line: 1, column: 1 },
    message: overrides.message ?? "test diagnostic",
    docsPath: overrides.docsPath ?? "docs/rules/test.md",
    suggestion: overrides.suggestion ?? "do something",
    measurementHint: overrides.measurementHint ?? "measure it",
    aiHandoff: overrides.aiHandoff ?? "hand off",
    confidence: overrides.confidence ?? "medium",
    why: overrides.why ?? "because",
  };
}

describe("isActionsFinding", () => {
  test.each([
    ["workflow scope", true, { scope: "workflow" }],
    ["undefined scope", true, {}],
    ["repository scope", false, { scope: "repository" }],
  ] as const)("%s -> %p", (_name, expected, overrides) => {
    expect(isActionsFinding(makeDiagnostic({ ruleId: "r1", workflow: "w", ...overrides }))).toBe(
      expected,
    );
  });
});

describe("findingIncludedInMode EP/BVA", () => {
  const suggestion = makeDiagnostic({ ruleId: "r1", workflow: "w", severity: "suggestion" });
  const warning = makeDiagnostic({ ruleId: "r1", workflow: "w", severity: "warning" });
  const error = makeDiagnostic({ ruleId: "r1", workflow: "w", severity: "error" });

  test.each([
    ["strict", "suggestion", false, suggestion],
    ["strict", "warning", true, warning],
    ["strict", "error", true, error],
    ["exploratory", "suggestion", true, suggestion],
    ["exploratory", "warning", true, warning],
    ["exploratory", "error", true, error],
  ] as const)("%s + %s -> %p", (mode, _severity, expected, diagnostic) => {
    expect(findingIncludedInMode(diagnostic, mode)).toBe(expected);
  });
});

describe("promoteStrictFallbackSuggestions BVA", () => {
  const pathsFilterSuggestion = makeDiagnostic({
    ruleId: "missing-paths-filter",
    workflow: "w",
    severity: "suggestion",
    score: 95,
  });
  const nonCodeSuggestion = makeDiagnostic({
    ruleId: "missing-path-ignore-for-non-code",
    workflow: "w",
    severity: "suggestion",
    score: 90,
  });
  const otherSuggestion = makeDiagnostic({
    ruleId: "other-rule",
    workflow: "w",
    severity: "suggestion",
    score: 50,
  });
  const existingWarning = makeDiagnostic({
    ruleId: "some-rule",
    workflow: "w",
    severity: "warning",
    score: 70,
  });

  test("no strict findings → promotes matching suggestions to warning", () => {
    const result = promoteStrictFallbackSuggestions([
      pathsFilterSuggestion,
      nonCodeSuggestion,
      otherSuggestion,
    ]);
    expect(result[0]?.severity).toBe("warning");
    expect(result[1]?.severity).toBe("warning");
    expect(result[2]?.severity).toBe("suggestion");
  });

  test("existing strict finding → no promotion", () => {
    const result = promoteStrictFallbackSuggestions([pathsFilterSuggestion, existingWarning]);
    expect(result[0]?.severity).toBe("suggestion");
    expect(result[1]?.severity).toBe("warning");
  });

  test("empty findings → empty", () => {
    expect(promoteStrictFallbackSuggestions([])).toEqual([]);
  });

  test("only non-matching suggestions → unchanged", () => {
    const result = promoteStrictFallbackSuggestions([otherSuggestion]);
    expect(result[0]?.severity).toBe("suggestion");
  });

  test("matching suggestion alone → promoted", () => {
    const result = promoteStrictFallbackSuggestions([pathsFilterSuggestion]);
    expect(result[0]?.severity).toBe("warning");
  });
});

describe("applyLimitedActionsPriority BVA", () => {
  const actionsFinding = (score: number): Diagnostic =>
    makeDiagnostic({ ruleId: "r1", workflow: "w", scope: "workflow", score });
  const repoFinding = (score: number): Diagnostic =>
    makeDiagnostic({ ruleId: "r2", workflow: "w", scope: "repository", score });

  test.each([
    ["empty", [], []],
    ["1 action finding", [actionsFinding(50)], [80]],
    ["repository finding", [repoFinding(50)], [50]],
  ] as const)("%s", (_name, findings, scores) => {
    expect(applyLimitedActionsPriority([...findings]).map((finding) => finding.score)).toEqual([
      ...scores,
    ]);
  });

  test("top 3 action findings get bonus (boundary)", () => {
    const f1 = actionsFinding(100);
    const f2 = actionsFinding(90);
    const f3 = actionsFinding(80);
    const f4 = actionsFinding(70);
    const result = applyLimitedActionsPriority([f1, f2, f3, f4]);
    // top 3 by score get bonus
    expect(result.find((f) => f.score === 130)?.score).toBe(130); // f1 + 30
    expect(result.find((f) => f.score === 120)?.score).toBe(120); // f2 + 30
    expect(result.find((f) => f.score === 110)?.score).toBe(110); // f3 + 30
    expect(result.find((f) => f.score === 70)?.score).toBe(70); // f4 unchanged
  });

  test("exactly 3 action findings: all get bonus (boundary)", () => {
    const f1 = actionsFinding(100);
    const f2 = actionsFinding(90);
    const f3 = actionsFinding(80);
    const result = applyLimitedActionsPriority([f1, f2, f3]);
    expect(result.find((f) => f.score === 130)?.score).toBe(130);
    expect(result.find((f) => f.score === 120)?.score).toBe(120);
    expect(result.find((f) => f.score === 110)?.score).toBe(110);
  });

  test("mix: repo findings interspersed don't count toward limit", () => {
    const f1 = actionsFinding(100);
    const f2 = repoFinding(99);
    const f3 = actionsFinding(80);
    const f4 = repoFinding(79);
    const result = applyLimitedActionsPriority([f1, f2, f3, f4]);
    expect(result[0]?.score).toBe(130);
    expect(result[1]?.score).toBe(99); // repo - unchanged
    expect(result[2]?.score).toBe(110);
    expect(result[3]?.score).toBe(79); // repo - unchanged
  });
});

describe("compareFindings ordering", () => {
  test("higher score comes first", () => {
    const a = makeDiagnostic({ ruleId: "r1", workflow: "w", score: 50 });
    const b = makeDiagnostic({ ruleId: "r2", workflow: "w", score: 100 });
    expect(compareFindings(a, b)).toBeGreaterThan(0); // a (50) should come after b (100)
    expect(compareFindings(b, a)).toBeLessThan(0);
  });

  test.each([
    [
      "same score sorts by workflow",
      makeDiagnostic({ ruleId: "r1", workflow: "a.yml", score: 50 }),
      makeDiagnostic({ ruleId: "r2", workflow: "b.yml", score: 50 }),
    ],
    [
      "same score and workflow sorts by ruleId",
      makeDiagnostic({ ruleId: "aaa", workflow: "w", score: 50 }),
      makeDiagnostic({ ruleId: "bbb", workflow: "w", score: 50 }),
    ],
    [
      "same score, workflow, ruleId sorts by path",
      makeDiagnostic({
        ruleId: "r1",
        workflow: "w",
        score: 50,
        location: { path: "a.yml", line: 1, column: 1 },
      }),
      makeDiagnostic({
        ruleId: "r1",
        workflow: "w",
        score: 50,
        location: { path: "b.yml", line: 1, column: 1 },
      }),
    ],
    [
      "same everything sorts by line",
      makeDiagnostic({
        ruleId: "r1",
        workflow: "w",
        score: 50,
        location: { path: "x.yml", line: 5, column: 1 },
      }),
      makeDiagnostic({
        ruleId: "r1",
        workflow: "w",
        score: 50,
        location: { path: "x.yml", line: 10, column: 1 },
      }),
    ],
    [
      "same everything except column sorts by column",
      makeDiagnostic({
        ruleId: "r1",
        workflow: "w",
        score: 50,
        location: { path: "x.yml", line: 1, column: 5 },
      }),
      makeDiagnostic({
        ruleId: "r1",
        workflow: "w",
        score: 50,
        location: { path: "x.yml", line: 1, column: 10 },
      }),
    ],
    [
      "same everything except message sorts by message",
      makeDiagnostic({ ruleId: "r1", workflow: "w", score: 50, message: "aaa" }),
      makeDiagnostic({ ruleId: "r1", workflow: "w", score: 50, message: "bbb" }),
    ],
  ] as const)("%s", (_name, a, b) => {
    expect(compareFindings(a, b)).toBeLessThan(0);
  });

  test("identical findings → 0", () => {
    const a = makeDiagnostic({ ruleId: "r1", workflow: "w", score: 50 });
    const b = makeDiagnostic({ ruleId: "r1", workflow: "w", score: 50 });
    expect(compareFindings(a, b)).toBe(0);
  });
});
