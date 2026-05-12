import { describe, expect, test } from "bun:test";
import type { AnalysisWarning, Diagnostic } from "../src/types.ts";
import type { InferenceGraph } from "../src/rules/shared/remediation-checks.ts";
import {
  composeRefiners,
  deduplicateRefiner,
  driftDetectionRefiner,
  maxFindingsRefiner,
  severityPromotionRefiner,
  modeFilterRefiner,
  sortRefiner,
  repositoryScopeFixRefiner,
} from "../src/refiner-pipeline.ts";

function makeDiagnostic(overrides: Partial<Diagnostic> & { ruleId: string }): Diagnostic {
  return {
    severity: "warning",
    confidence: "medium",
    docsPath: "docs/rules/test.md",
    workflow: ".github/workflows/ci.yml",
    location: { path: "test.yml", line: 1, column: 1 },
    message: "Test finding.",
    why: "Reason.",
    suggestion: "Fix it.",
    measurementHint: "Measure it.",
    aiHandoff: "Handoff.",
    score: 50,
    ...overrides,
  };
}

describe("deduplicateRefiner", () => {
  test("removes diagnostics with same path:line", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 1, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-b", location: { path: "a.yml", line: 1, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-c", location: { path: "b.yml", line: 2, column: 1 } }),
    ];
    const result = deduplicateRefiner().refine(diagnostics, {});
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.ruleId).sort()).toEqual(["rule-a", "rule-c"]);
  });

  test("keeps different path:line", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 1, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 2, column: 1 } }),
    ];
    const result = deduplicateRefiner().refine(diagnostics, {});
    expect(result).toHaveLength(2);
  });

  test("empty input returns empty", () => {
    const result = deduplicateRefiner().refine([], {});
    expect(result).toEqual([]);
  });
});

describe("maxFindingsRefiner", () => {
  test("caps findings per ruleId", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 1, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 2, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 3, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-b", location: { path: "b.yml", line: 1, column: 1 } }),
    ];
    const caps = new Map([["rule-a", 2]]);
    const result = maxFindingsRefiner(caps, new Set()).refine(diagnostics, {});
    expect(result).toHaveLength(3);
    expect(result.filter((d) => d.ruleId === "rule-a")).toHaveLength(2);
    expect(result.filter((d) => d.ruleId === "rule-b")).toHaveLength(1);
  });

  test("bypasses cap for implied rule IDs", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-implied", location: { path: "a.yml", line: 1, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-implied", location: { path: "a.yml", line: 2, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-implied", location: { path: "a.yml", line: 3, column: 1 } }),
    ];
    const caps = new Map([["rule-implied", 1]]);
    const implied = new Set(["rule-implied"]);
    const result = maxFindingsRefiner(caps, implied).refine(diagnostics, {});
    expect(result).toHaveLength(3);
  });

  test("no caps returns all diagnostics", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-a" }),
      makeDiagnostic({ ruleId: "rule-b" }),
    ];
    const result = maxFindingsRefiner(new Map(), new Set()).refine(diagnostics, {});
    expect(result).toHaveLength(2);
  });

  test("emits warning when findings are suppressed", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 1, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 2, column: 1 } }),
    ];
    const warnings: AnalysisWarning[] = [];
    const caps = new Map([["rule-a", 1]]);
    maxFindingsRefiner(caps, new Set()).refine(diagnostics, {
      warnings,
      workflowPath: "test.yml",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("max-findings-hit");
  });
});

describe("severityPromotionRefiner", () => {
  test("promotes suggestions to warnings in strict mode when no warnings exist", () => {
    const diagnostics = [
      makeDiagnostic({
        ruleId: "missing-concurrency",
        severity: "suggestion",
      }),
    ];
    const result = severityPromotionRefiner("strict").refine(diagnostics, {});
    expect(result[0]?.severity).toBe("warning");
  });

  test("does not promote in exploratory mode", () => {
    const diagnostics = [
      makeDiagnostic({
        ruleId: "missing-concurrency",
        severity: "suggestion",
      }),
    ];
    const result = severityPromotionRefiner("exploratory").refine(diagnostics, {});
    expect(result[0]?.severity).toBe("suggestion");
  });
});

describe("modeFilterRefiner", () => {
  test("filters out suggestions in strict mode", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-a", severity: "warning" }),
      makeDiagnostic({ ruleId: "rule-b", severity: "suggestion" }),
    ];
    const result = modeFilterRefiner("strict").refine(diagnostics, {});
    expect(result).toHaveLength(1);
    expect(result[0]?.ruleId).toBe("rule-a");
  });

  test("keeps all findings in exploratory mode", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-a", severity: "warning" }),
      makeDiagnostic({ ruleId: "rule-b", severity: "suggestion" }),
    ];
    const result = modeFilterRefiner("exploratory").refine(diagnostics, {});
    expect(result).toHaveLength(2);
  });
});

describe("repositoryScopeFixRefiner", () => {
  test("sets scope to repository when source.kind is repository and scope is undefined", () => {
    const diagnostics = [
      makeDiagnostic({
        ruleId: "rule-a",
        scope: undefined,
        source: {
          kind: "repository",
          workflowPath: "package.json",
          location: { path: "package.json", line: 1, column: 1 },
        },
      }),
    ];
    const result = repositoryScopeFixRefiner().refine(diagnostics, {});
    expect(result[0]?.scope).toBe("repository");
  });

  test("does not change scope when already set", () => {
    const diagnostics = [
      makeDiagnostic({
        ruleId: "rule-a",
        scope: "workflow",
        source: {
          kind: "repository",
          workflowPath: "package.json",
          location: { path: "package.json", line: 1, column: 1 },
        },
      }),
    ];
    const result = repositoryScopeFixRefiner().refine(diagnostics, {});
    expect(result[0]?.scope).toBe("workflow");
  });
});

describe("sortRefiner", () => {
  test("sorts by score descending", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-a", score: 50 }),
      makeDiagnostic({ ruleId: "rule-b", score: 100 }),
      makeDiagnostic({ ruleId: "rule-c", score: 75 }),
    ];
    const result = sortRefiner().refine(diagnostics, {});
    expect(result.map((d) => d.score)).toEqual([100, 75, 50]);
  });
});

describe("composeRefiners", () => {
  test("applies refiners in order", () => {
    const diagnostics = [
      makeDiagnostic({
        ruleId: "rule-a",
        location: { path: "a.yml", line: 1, column: 1 },
        score: 50,
      }),
      makeDiagnostic({
        ruleId: "rule-a",
        location: { path: "a.yml", line: 1, column: 1 },
        score: 40,
      }),
      makeDiagnostic({
        ruleId: "rule-a",
        location: { path: "a.yml", line: 2, column: 1 },
        score: 10,
      }),
    ];
    const caps = new Map([["rule-a", 2]]);
    const pipeline = composeRefiners([maxFindingsRefiner(caps, new Set()), deduplicateRefiner()]);
    const result = pipeline.refine(diagnostics, {});
    // maxFindings caps to first 2 (both at line 1), dedup removes the duplicate → only line 1 remains
    expect(result).toHaveLength(1);
    expect(result[0]?.location.line).toBe(1);
    expect(result[0]?.score).toBe(50);
  });

  test("drift detection pushes warnings when implied rule has no findings", () => {
    const graph: InferenceGraph = {
      forwards: new Map([["rule-a", ["rule-b"]]]),
      reverse: new Map([["rule-b", ["rule-a"]]]),
      transitiveForwards: new Map([["rule-a", new Set(["rule-b"])]]),
    };
    const fired = new Set(["rule-a"]);
    const evaluated = new Set(["rule-a", "rule-b"]);
    const warnings: AnalysisWarning[] = [];

    driftDetectionRefiner(fired, evaluated, graph).refine([], { warnings });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("remediation-drift");
    expect(warnings[0]?.message).toContain("rule-b");
    expect(warnings[0]?.message).toContain("no findings");
  });

  test("drift detection does not warn when implied rule also fired", () => {
    const graph: InferenceGraph = {
      forwards: new Map([["rule-a", ["rule-b"]]]),
      reverse: new Map([["rule-b", ["rule-a"]]]),
      transitiveForwards: new Map([["rule-a", new Set(["rule-b"])]]),
    };
    const fired = new Set(["rule-a", "rule-b"]);
    const evaluated = new Set(["rule-a", "rule-b"]);
    const warnings: AnalysisWarning[] = [];

    driftDetectionRefiner(fired, evaluated, graph).refine([], { warnings });

    expect(warnings).toEqual([]);
  });

  test("identity for empty refiner list", () => {
    const diagnostics = [makeDiagnostic({ ruleId: "rule-a" })];
    const pipeline = composeRefiners([]);
    const result = pipeline.refine(diagnostics, {});
    expect(result).toEqual(diagnostics);
  });
});
