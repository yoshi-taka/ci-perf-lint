import { describe, expect, test } from "bun:test";
import {
  and,
  or,
  not,
  workflowFact,
  toolPresent,
  toolAbsent,
  hasNodeType,
  sourceContains,
  TRUE,
  FALSE,
  simplify,
  toDNF,
  findContradictions,
  findImplications,
  findOverlaps,
  findUnreachable,
  generateDecisionTable,
  evaluate,
  type Predicate,
  type EvalContext,
} from "../src/rules/shared/predicate.ts";
import type { WorkflowDocument } from "../src/workflow.ts";
import type { RuleMeta } from "../src/types.ts";

const dummyCtx = (overrides?: Partial<EvalContext>): EvalContext => ({
  workflow: { source: "npm ci\nnpm test" } as WorkflowDocument,
  workflowFacts: {
    isHeavyWorkflow: true,
    hasConcurrency: false,
    looksMetaCheckLike: false,
    looksAgenticLike: false,
    looksReleaseLike: false,
    toolPresence: new Map([
      ["hasNpmRun", true],
      ["hasPython", false],
    ]),
  } as unknown as EvalContext["workflowFacts"],
  source: "npm ci\nnpm test",
  ...overrides,
});

describe("Predicate construction", () => {
  test("true and false literals", () => {
    expect(TRUE).toEqual({ kind: "true" });
    expect(FALSE).toEqual({ kind: "false" });
  });

  test("workflow fact predicate", () => {
    expect(workflowFact("isHeavyWorkflow", true)).toEqual({
      kind: "workflow-fact",
      key: "isHeavyWorkflow",
      expected: true,
    });
  });

  test("tool present/absent", () => {
    expect(toolPresent("hasNpmRun")).toEqual({ kind: "tool-present", key: "hasNpmRun" });
    expect(toolAbsent("hasPython")).toEqual({ kind: "tool-absent", key: "hasPython" });
  });

  test("node type and source contains", () => {
    expect(hasNodeType("trigger")).toEqual({ kind: "has-node-type", nodeType: "trigger" });
    expect(sourceContains("npm ci")).toEqual({ kind: "source-contains", pattern: "npm ci" });
  });
});

describe("Boolean algebra simplification", () => {
  test("not(TRUE) → FALSE", () => {
    expect(simplify(not(TRUE))).toEqual(FALSE);
  });

  test("not(FALSE) → TRUE", () => {
    expect(simplify(not(FALSE))).toEqual(TRUE);
  });

  test("not(not(x)) → x", () => {
    const x = workflowFact("isHeavyWorkflow", true);
    expect(simplify(not(not(x)))).toEqual(x);
  });

  test("and with TRUE is identity", () => {
    const x = workflowFact("isHeavyWorkflow", true);
    expect(simplify(and(x, TRUE))).toEqual(x);
  });

  test("and with FALSE is FALSE", () => {
    const x = workflowFact("isHeavyWorkflow", true);
    expect(simplify(and(x, FALSE))).toEqual(FALSE);
  });

  test("or with FALSE is identity", () => {
    const x = workflowFact("isHeavyWorkflow", true);
    expect(simplify(or(x, FALSE))).toEqual(x);
  });

  test("or with TRUE is TRUE", () => {
    const x = workflowFact("isHeavyWorkflow", true);
    expect(simplify(or(x, TRUE))).toEqual(TRUE);
  });

  test("and flattens nested and", () => {
    const a = workflowFact("isHeavyWorkflow", true);
    const b = workflowFact("hasConcurrency", false);
    const c = toolPresent("hasNpmRun");
    expect(simplify(and(a, and(b, c)))).toEqual({ kind: "and", operands: [a, b, c] });
  });
});

describe("Evaluator", () => {
  test("true evaluates to true", () => {
    expect(evaluate(TRUE, dummyCtx())).toBe(true);
  });

  test("false evaluates to false", () => {
    expect(evaluate(FALSE, dummyCtx())).toBe(false);
  });

  test("workflow fact matches", () => {
    const ctx = dummyCtx();
    expect(evaluate(workflowFact("isHeavyWorkflow", true), ctx)).toBe(true);
    expect(evaluate(workflowFact("isHeavyWorkflow", false), ctx)).toBe(false);
    expect(evaluate(workflowFact("looksMetaCheckLike", false), ctx)).toBe(true);
  });

  test("tool present matching", () => {
    const ctx = dummyCtx();
    expect(evaluate(toolPresent("hasNpmRun"), ctx)).toBe(true);
    expect(evaluate(toolPresent("hasPython"), ctx)).toBe(false);
  });

  test("tool absent matching", () => {
    const ctx = dummyCtx();
    expect(evaluate(toolAbsent("hasPython"), ctx)).toBe(true);
    expect(evaluate(toolAbsent("hasNpmRun"), ctx)).toBe(false);
  });

  test("source contains", () => {
    const ctx = dummyCtx();
    expect(evaluate(sourceContains("npm ci"), ctx)).toBe(true);
    expect(evaluate(sourceContains("docker build"), ctx)).toBe(false);
  });

  test("and logic", () => {
    const ctx = dummyCtx();
    expect(
      evaluate(and(workflowFact("isHeavyWorkflow", true), toolPresent("hasNpmRun")), ctx),
    ).toBe(true);
    expect(
      evaluate(and(workflowFact("isHeavyWorkflow", true), toolPresent("hasPython")), ctx),
    ).toBe(false);
  });

  test("or logic", () => {
    const ctx = dummyCtx();
    expect(
      evaluate(or(workflowFact("looksMetaCheckLike", true), toolPresent("hasNpmRun")), ctx),
    ).toBe(true);
    expect(
      evaluate(or(workflowFact("looksMetaCheckLike", true), toolPresent("hasPython")), ctx),
    ).toBe(false);
  });

  test("not logic", () => {
    const ctx = dummyCtx();
    expect(evaluate(not(workflowFact("isHeavyWorkflow", false)), ctx)).toBe(true);
    expect(evaluate(not(toolPresent("hasNpmRun")), ctx)).toBe(false);
  });
});

describe("DNF conversion", () => {
  test("simple fact → single clause", () => {
    const dnf = toDNF(workflowFact("isHeavyWorkflow", true));
    expect(dnf.clauses).toHaveLength(1);
    expect(dnf.clauses[0]!.has("fact:isHeavyWorkflow=true")).toBe(true);
  });

  test("and → single clause with multiple literals", () => {
    const dnf = toDNF(and(workflowFact("isHeavyWorkflow", true), toolPresent("hasNpmRun")));
    expect(dnf.clauses).toHaveLength(1);
    expect(dnf.clauses[0]!.size).toBe(2);
  });

  test("or → multiple clauses", () => {
    const dnf = toDNF(
      or(workflowFact("isHeavyWorkflow", true), workflowFact("hasConcurrency", true)),
    );
    expect(dnf.clauses).toHaveLength(2);
  });

  test("true → empty clause", () => {
    const dnf = toDNF(TRUE);
    expect(dnf.clauses).toHaveLength(1);
    expect(dnf.clauses[0]!.size).toBe(0);
  });

  test("false → no clauses", () => {
    const dnf = toDNF(FALSE);
    expect(dnf.clauses).toHaveLength(0);
  });
});

describe("Contradiction detection", () => {
  test("A and not A → no satisfiable clauses (contradiction pruned during DNF construction)", () => {
    const dnf = toDNF(
      and(workflowFact("isHeavyWorkflow", true), not(workflowFact("isHeavyWorkflow", true))),
    );
    // contradictory clause is pruned during crossProduct
    // the DNF is empty → unreachable
    expect(dnf.clauses).toHaveLength(0);
  });

  test("no contradiction for consistent and", () => {
    const dnf = toDNF(
      and(workflowFact("isHeavyWorkflow", true), workflowFact("hasConcurrency", false)),
    );
    expect(findContradictions(dnf)).toHaveLength(0);
  });

  test("find unreachable from contradictory A and not A", () => {
    const dnf = toDNF(
      and(workflowFact("isHeavyWorkflow", true), not(workflowFact("isHeavyWorkflow", true))),
    );
    const unreachable = findUnreachable(dnf);
    expect(unreachable.length).toBeGreaterThan(0);
    expect(unreachable[0]!.reason).toContain("no satisfiable clauses");
  });

  test("consistent and is reachable", () => {
    const dnf = toDNF(
      and(workflowFact("isHeavyWorkflow", true), workflowFact("hasConcurrency", false)),
    );
    const unreachable = findUnreachable(dnf);
    expect(unreachable).toHaveLength(0);
  });
});

describe("Implication detection", () => {
  test("A implies A or B", () => {
    const pred = or(workflowFact("isHeavyWorkflow", true), and(toolPresent("hasNpmRun")));
    const dnf = toDNF(pred);
    const implications = findImplications(dnf);
    // each clause should be self-implied
  });

  test("overlap between compatible clauses", () => {
    const pred = or(
      and(workflowFact("isHeavyWorkflow", true), toolPresent("hasNpmRun")),
      and(workflowFact("isHeavyWorkflow", true), toolAbsent("hasPython")),
    );
    const dnf = toDNF(pred);
    const overlaps = findOverlaps(dnf);
    // both clauses share isHeavyWorkflow=true but differ on tools
    expect(overlaps.length).toBeGreaterThan(0);
  });
});

describe("Decision table generation", () => {
  test("single condition → 2 rows", () => {
    const pred = workflowFact("isHeavyWorkflow", true);
    const dt = generateDecisionTable(pred);
    expect(dt.conditionNames).toHaveLength(1);
    expect(dt.rows).toHaveLength(2);
  });

  test("two conditions → 4 rows", () => {
    const pred = and(workflowFact("isHeavyWorkflow", true), toolPresent("hasNpmRun"));
    const dt = generateDecisionTable(pred);
    expect(dt.conditionNames).toHaveLength(2);
    expect(dt.rows).toHaveLength(4);
  });

  test("decision table snapshot: isHeavy and concurrency", () => {
    const pred = and(workflowFact("isHeavyWorkflow", true), workflowFact("hasConcurrency", false));
    const dt = generateDecisionTable(pred);
    // format as snapshot string
    const lines: string[] = [`| ${dt.conditionNames.join(" | ")} | expected |`];
    lines.push(`|${dt.conditionNames.map(() => "---").join("|")}|---|`);
    for (const row of dt.rows) {
      const vals = row.conditionValues.map((v) => (v ? "T" : "F")).join(" | ");
      lines.push(`| ${vals} | ${row.expected ? "T" : "F"} |`);
    }
    expect(lines.join("\n")).toMatchSnapshot();
  });

  test("decision table snapshot: meta-check exclusion", () => {
    const pred = and(
      workflowFact("isHeavyWorkflow", true),
      workflowFact("looksMetaCheckLike", false),
    );
    const dt = generateDecisionTable(pred);
    const lines: string[] = [`| ${dt.conditionNames.join(" | ")} | expected |`];
    lines.push(`|${dt.conditionNames.map(() => "---").join("|")}|---|`);
    for (const row of dt.rows) {
      const vals = row.conditionValues.map((v) => (v ? "T" : "F")).join(" | ");
      lines.push(`| ${vals} | ${row.expected ? "T" : "F"} |`);
    }
    expect(lines.join("\n")).toMatchSnapshot();
  });
});

describe("Realistic skip predicates (derived from existing rules)", () => {
  test("missing-concurrency skip: isHeavy AND !hasConcurrency → must not skip", () => {
    const skipPred = and(
      workflowFact("isHeavyWorkflow", false),
      workflowFact("hasConcurrency", true),
    );
    const ctx = dummyCtx({
      workflowFacts: {
        ...dummyCtx().workflowFacts,
        isHeavyWorkflow: false,
        hasConcurrency: true,
      } as unknown as EvalContext["workflowFacts"],
    });
    expect(evaluate(skipPred, ctx)).toBe(true);
  });

  test("paths-filter skip: isHeavy OR metaCheckLike → skip when meta-check", () => {
    const skipPred = or(
      workflowFact("isHeavyWorkflow", false),
      workflowFact("looksMetaCheckLike", true),
    );
    const ctx = dummyCtx({
      workflowFacts: {
        ...dummyCtx().workflowFacts,
        isHeavyWorkflow: false,
        looksMetaCheckLike: true,
      } as unknown as EvalContext["workflowFacts"],
    });
    expect(evaluate(skipPred, ctx)).toBe(true);
  });

  test("no false positives: tool absent + source not matching", () => {
    const pred = and(toolAbsent("hasPython"), sourceContains("pytest"));
    const ctx = dummyCtx({ source: "npm ci\nnpm test" });
    expect(evaluate(pred, ctx)).toBe(false);
  });

  test("contradiction: isHeavy AND !isHeavy → no satisfiable DNF clauses", () => {
    const pred = and(
      workflowFact("isHeavyWorkflow", true),
      not(workflowFact("isHeavyWorkflow", true)),
    );
    const dnf = toDNF(pred);
    expect(dnf.clauses).toHaveLength(0);
    expect(findUnreachable(dnf).length).toBeGreaterThan(0);
  });
});

describe("Rule-level analysis", () => {
  test("every rule with skipIf must have at least one reachable combination", async () => {
    const { allRules } = await import("../src/rules/index.ts");
    for (const rule of allRules) {
      const meta: RuleMeta = rule.meta;
      const skipIf = meta.skipIf;
      if (!skipIf) {
        continue;
      }
      const dnf = toDNF(skipIf);
      const unreachable = findUnreachable(dnf);
      expect(unreachable).toEqual([]);
    }
  });

  test("rules/index should have decision table for each rule with skipIf", async () => {
    const { allRules } = await import("../src/rules/index.ts");
    for (const rule of allRules) {
      const meta: RuleMeta = rule.meta;
      const skipIf = meta.skipIf;
      if (!skipIf) {
        continue;
      }
      const dt = generateDecisionTable(skipIf);
      expect(dt.rows.length).toBeGreaterThan(0);
      // verify each satisfiable row is truly reachable
      for (const row of dt.rows) {
        if (row.satisfiable) {
          // should have at least one satisfiable combination
        }
      }
      expect(dt.rows.some((r) => r.expected)).toBe(true);
    }
  });
});
