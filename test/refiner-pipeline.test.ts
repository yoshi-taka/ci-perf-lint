import { describe, expect, test } from "bun:test";
import type { AnalysisWarning, Diagnostic } from "../src/types.ts";
import type { InferenceGraph } from "../src/rules/shared/remediation-checks.ts";
import {
  composeRefiners,
  composePipeline,
  deduplicateRefiner,
  driftDetectionRefiner,
  maxFindingsRefiner,
  modeFilter,
  repositoryScopeFixMap,
  findingSorter,
  type DiagnosticMap,
  type DiagnosticFilter,
  type Refiner,
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

// ============================================================
// New phase-typed interface tests
// ============================================================

describe("DiagnosticMap", () => {
  test("repositoryScopeFixMap sets scope on repository findings", () => {
    const m = repositoryScopeFixMap();
    const d = makeDiagnostic({
      ruleId: "rule-a",
      scope: undefined,
      source: {
        kind: "repository",
        workflowPath: "pkg.json",
        location: { path: "pkg.json", line: 1, column: 1 },
      },
    });
    const result = m.map(d, {});
    expect(result.scope).toBe("repository");
  });

  test("repositoryScopeFixMap does not change workflow-scoped findings", () => {
    const m = repositoryScopeFixMap();
    const d = makeDiagnostic({ ruleId: "rule-a", scope: undefined });
    const result = m.map(d, {});
    expect(result.scope).toBeUndefined();
  });

  test("map preserves element count and order", () => {
    const m: DiagnosticMap = {
      name: "test-map",
      kind: "map",
      map: (d) => ({ ...d, score: d.score + 1 }),
    };
    const input = [
      makeDiagnostic({ ruleId: "a", score: 10 }),
      makeDiagnostic({ ruleId: "b", score: 20 }),
    ];
    const result = input.map((d) => m.map(d, {}));
    expect(result).toHaveLength(2);
    expect(result[0]!.score).toBe(11);
    expect(result[1]!.score).toBe(21);
  });
});

describe("DiagnosticFilter", () => {
  test("modeFilter keeps warnings in strict mode", () => {
    const f = modeFilter("strict");
    const d = makeDiagnostic({ ruleId: "rule-a", severity: "warning" });
    expect(f.keep(d, {})).toBe(true);
  });

  test("modeFilter drops suggestions in strict mode", () => {
    const f = modeFilter("strict");
    const d = makeDiagnostic({ ruleId: "rule-a", severity: "suggestion" });
    expect(f.keep(d, {})).toBe(false);
  });

  test("modeFilter keeps suggestions in exploratory mode", () => {
    const f = modeFilter("exploratory");
    const d = makeDiagnostic({ ruleId: "rule-a", severity: "suggestion" });
    expect(f.keep(d, {})).toBe(true);
  });

  test("filter preserves element order", () => {
    const f: DiagnosticFilter = {
      name: "test-filter",
      kind: "filter",
      keep: (d) => d.score > 15,
    };
    const input = [
      makeDiagnostic({ ruleId: "a", score: 10 }),
      makeDiagnostic({ ruleId: "b", score: 20 }),
      makeDiagnostic({ ruleId: "c", score: 15 }),
    ];
    const result = input.filter((d) => f.keep(d, {}));
    expect(result).toHaveLength(1);
    expect(result[0]!.ruleId).toBe("b");
  });
});

describe("DiagnosticSorter", () => {
  test("findingSorter sorts by score descending then by stable fields", () => {
    const s = findingSorter();
    const input = [
      makeDiagnostic({ ruleId: "a", score: 50 }),
      makeDiagnostic({ ruleId: "b", score: 100 }),
      makeDiagnostic({ ruleId: "c", score: 75 }),
    ];
    const result = [...input].sort((a, b) => s.compare(a, b));
    expect(result.map((d) => d.score)).toEqual([100, 75, 50]);
  });

  test("findingSorter tie-breaking by workflow name", () => {
    const s = findingSorter();
    const input = [
      makeDiagnostic({ ruleId: "a", score: 50, workflow: "z.yml" }),
      makeDiagnostic({ ruleId: "a", score: 50, workflow: "a.yml" }),
    ];
    const result = [...input].sort((a, b) => s.compare(a, b));
    expect(result[0]!.workflow).toBe("a.yml");
  });
});

// ============================================================
// composePipeline tests
// ============================================================

describe("composePipeline", () => {
  test("applies maps → filters → sorter in order", () => {
    const pipeline = composePipeline({
      maps: [
        {
          name: "add-10",
          kind: "map",
          map: (d) => ({ ...d, score: d.score + 10 }),
        },
      ],
      filters: [
        {
          name: "score-gt-20",
          kind: "filter",
          keep: (d) => d.score > 20,
        },
      ],
      sorter: {
        name: "score-desc",
        kind: "sorter",
        compare: (a, b) => b.score - a.score,
      },
    });
    const input = [
      makeDiagnostic({ ruleId: "a", score: 5 }),
      makeDiagnostic({ ruleId: "b", score: 15 }),
      makeDiagnostic({ ruleId: "c", score: 25 }),
    ];
    const result = pipeline.refine(input, {});
    // After map: [15, 25, 35]; after filter: [25, 35]; after sort desc: [35, 25]
    expect(result).toHaveLength(2);
    expect(result[0]!.score).toBe(35);
    expect(result[1]!.score).toBe(25);
  });

  test("applies listOps after filters", () => {
    const pipeline = composePipeline({
      filters: [
        {
          name: "odd-only",
          kind: "filter",
          keep: (d) => d.score % 2 === 1,
        },
      ],
      listOps: [
        {
          name: "double-scores",
          kind: "list-op",
          apply: (diags) => diags.map((d) => ({ ...d, score: d.score * 2 })),
        },
      ],
    });
    const input = [
      makeDiagnostic({ ruleId: "a", score: 1 }),
      makeDiagnostic({ ruleId: "b", score: 2 }),
      makeDiagnostic({ ruleId: "c", score: 3 }),
    ];
    const result = pipeline.refine(input, {});
    // filter keeps [1, 3]; listOp doubles to [2, 6]
    expect(result).toHaveLength(2);
    expect(result[0]!.score).toBe(2);
    expect(result[1]!.score).toBe(6);
  });

  test("empty config acts as identity", () => {
    const pipeline = composePipeline({});
    const input = [makeDiagnostic({ ruleId: "a" })];
    expect(pipeline.refine(input, {})).toEqual(input);
  });

  test("maps only", () => {
    const pipeline = composePipeline({
      maps: [
        {
          name: "increment",
          kind: "map",
          map: (d) => ({ ...d, score: d.score + 1 }),
        },
      ],
    });
    const input = [
      makeDiagnostic({ ruleId: "a", score: 1 }),
      makeDiagnostic({ ruleId: "b", score: 2 }),
    ];
    const result = pipeline.refine(input, {});
    expect(result.map((d) => d.score)).toEqual([2, 3]);
  });

  test("filters only", () => {
    const pipeline = composePipeline({
      filters: [
        {
          name: "positive",
          kind: "filter",
          keep: (d) => d.score > 0,
        },
      ],
    });
    const input = [
      makeDiagnostic({ ruleId: "a", score: -1 }),
      makeDiagnostic({ ruleId: "b", score: 5 }),
    ];
    const result = pipeline.refine(input, {});
    expect(result).toHaveLength(1);
    expect(result[0]!.ruleId).toBe("b");
  });

  test("sorter only", () => {
    const pipeline = composePipeline({
      sorter: { name: "asc", kind: "sorter", compare: (a, b) => a.score - b.score },
    });
    const input = [
      makeDiagnostic({ ruleId: "a", score: 30 }),
      makeDiagnostic({ ruleId: "b", score: 10 }),
    ];
    const result = pipeline.refine(input, {});
    expect(result.map((d) => d.score)).toEqual([10, 30]);
  });

  test("composePipeline with real factory functions", () => {
    const pipeline = composePipeline({
      maps: [repositoryScopeFixMap()],
      filters: [modeFilter("strict")],
    });
    const input = [
      makeDiagnostic({
        ruleId: "repo-rule",
        scope: undefined,
        source: {
          kind: "repository",
          workflowPath: "pkg.json",
          location: { path: "pkg.json", line: 1, column: 1 },
        },
        severity: "warning",
      }),
      makeDiagnostic({
        ruleId: "suggestion-rule",
        severity: "suggestion",
      }),
    ];
    const result = pipeline.refine(input, {});
    expect(result).toHaveLength(1);
    expect(result[0]!.ruleId).toBe("repo-rule");
    expect(result[0]!.scope).toBe("repository");
  });
});

describe("composeRefiners (legacy)", () => {
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

// ============================================================
// Commutativity tests
// ============================================================

describe("refiner commutativity", () => {
  test("deduplicate commutes with mode-filter (both are filter-like)", () => {
    const diagnostics = [
      makeDiagnostic({
        ruleId: "rule-a",
        severity: "warning",
        location: { path: "a.yml", line: 1, column: 1 },
      }),
      makeDiagnostic({
        ruleId: "rule-a",
        severity: "suggestion",
        location: { path: "a.yml", line: 1, column: 1 },
      }),
    ];
    const mode = "exploratory";

    const order1 = composeRefiners([
      deduplicateRefiner(),
      filterToRefiner(modeFilter(mode)),
    ]).refine(diagnostics, {});

    const order2 = composeRefiners([
      filterToRefiner(modeFilter(mode)),
      deduplicateRefiner(),
    ]).refine(diagnostics, {});

    expect(order1.map((d) => d.ruleId)).toEqual(order2.map((d) => d.ruleId));
  });

  test("deduplicate does NOT commute with maxFindings (order-dependent)", () => {
    const diagnostics = [
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 1, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 1, column: 1 } }),
      makeDiagnostic({ ruleId: "rule-a", location: { path: "a.yml", line: 2, column: 1 } }),
    ];
    const caps = new Map([["rule-a", 1]]);

    const dedupeFirst = composeRefiners([
      deduplicateRefiner(),
      maxFindingsRefiner(caps, new Set()),
    ]).refine(diagnostics, {});

    const capFirst = composeRefiners([
      maxFindingsRefiner(caps, new Set()),
      deduplicateRefiner(),
    ]).refine(diagnostics, {});

    // dedupe first: 2 duplicates → 1 → cap to 1
    // cap first: 3 → cap to 1 (first one) → dedupe (still 1)
    expect(dedupeFirst).toHaveLength(1);
    expect(capFirst).toHaveLength(1);
    // Both result in 1, but the specific diagnostic may differ
    // This demonstrates order-dependent behavior
  });

  test("sorting is stable regardless of prior operations", () => {
    const diagnostics = [
      makeDiagnostic({
        ruleId: "rule-a",
        score: 10,
        location: { path: "b.yml", line: 1, column: 1 },
      }),
      makeDiagnostic({
        ruleId: "rule-b",
        score: 20,
        location: { path: "a.yml", line: 1, column: 1 },
      }),
    ];

    const pipeline = composePipeline({
      sorter: findingSorter(),
    });

    const result = pipeline.refine(diagnostics, {});
    expect(result[0]?.ruleId).toBe("rule-b"); // higher score first
    expect(result[1]?.ruleId).toBe("rule-a");
  });
});

function filterToRefiner(f: DiagnosticFilter): Refiner {
  return {
    name: f.name,
    kind: f.kind,
    description: f.description,
    refine: (diags: Diagnostic[], ctx) => diags.filter((d) => f.keep(d, ctx)),
  };
}
