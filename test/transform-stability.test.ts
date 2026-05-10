import { describe, expect, test, beforeEach } from "bun:test";
import {
  pipe,
  taggedPipe,
  identityDiagnosticTransform,
  resetTransformTracking,
  type DiagnosticTransform,
} from "../src/rules/shared/diagnostic-transform.ts";
import { simulateRepeatedTransform } from "../src/transform-stability.ts";
import { applySeverityPromotion } from "../src/severity-promotion.ts";
import { aggregateFindingsWithMembers } from "../src/reporters-aggregation.ts";
import type { Diagnostic } from "../src/types.ts";

function sample(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    ruleId: "test-rule",
    severity: "warning",
    confidence: "high",
    docsPath: "docs/rules/test.md",
    workflow: "ci.yml",
    location: { path: "ci.yml", line: 1, column: 1 },
    message: "msg",
    why: "base why",
    suggestion: "suggest",
    measurementHint: "measure",
    aiHandoff: "base handoff",
    score: 40,
    ...overrides,
  };
}

function makeConsensusTransform(scoreBonus: number, label?: string): DiagnosticTransform {
  return (d) => ({
    ...d,
    score: d.score + scoreBonus,
    why: `${d.why} ${label ?? "consensus"} context.`,
    aiHandoff: `${d.aiHandoff} ${label ?? "consensus"} handoff.`,
  });
}

function makePrecedentTransform(label?: string): DiagnosticTransform {
  return (d) => ({
    ...d,
    why: `${d.why} ${label ?? "precedent"} context.`,
    aiHandoff: `${d.aiHandoff} ${label ?? "precedent"} handoff.`,
  });
}

function makeStackedDiffTransform(scoreBonus: number): DiagnosticTransform {
  return (d) => ({
    ...d,
    score: d.score + scoreBonus,
    why: `${d.why} stacked diff context.`,
    aiHandoff: `${d.aiHandoff} stacked diff handoff.`,
  });
}

// --- Individual transform stability ---

describe("unstable transforms (no idempotency)", () => {
  test("raw score-additive transform is unstable", () => {
    const add = (d: Diagnostic): Diagnostic => ({ ...d, score: d.score + 10 });
    const result = simulateRepeatedTransform(add, sample());

    expect(result.stable).toBe(false);
    expect(result.converged).toBe(false);
    expect(result.amplificationDetected).toBe(true);
    expect(result.repeatedScoreGrowth).toBe(true);
    expect(result.maxObservedDelta).toBe(10);
    expect(result.iterations).toHaveLength(10);
    expect(result.iterations[0]!.score).toBe(50);
    expect(result.iterations[9]!.score).toBe(140);
  });

  test("raw consensus-like transform (score + text) is unstable", () => {
    const t = makeConsensusTransform(5, "consensus");
    const result = simulateRepeatedTransform(t, sample());

    expect(result.stable).toBe(false);
    expect(result.converged).toBe(false);
    expect(result.repeatedScoreGrowth).toBe(true);
    expect(result.iterations[0]!.score).toBe(45);
    expect(result.iterations[3]!.score).toBe(60);
    expect(result.iterations[0]!.whyLength).toBeGreaterThan(sample().why.length);
    expect(result.iterations[9]!.whyLength).toBeGreaterThan(result.iterations[0]!.whyLength);
  });

  test("raw precedent-like transform (text append only) is unstable", () => {
    const t = makePrecedentTransform("precedent");
    const result = simulateRepeatedTransform(t, sample());

    expect(result.stable).toBe(false);
    expect(result.repeatedScoreGrowth).toBe(false);
    expect(result.iterations[0]!.score).toBe(40);
    expect(result.iterations[9]!.score).toBe(40);
    expect(result.iterations[0]!.whyLength).toBeGreaterThan(sample().why.length);
    expect(result.iterations[9]!.whyLength).toBeGreaterThan(result.iterations[0]!.whyLength);
  });

  test("raw stacked-diff-like transform is unstable", () => {
    const t = makeStackedDiffTransform(8);
    const result = simulateRepeatedTransform(t, sample());

    expect(result.stable).toBe(false);
    expect(result.amplificationDetected).toBe(true);
    expect(result.repeatedScoreGrowth).toBe(true);
    expect(result.iterations[0]!.score).toBe(48);
    expect(result.iterations[4]!.score).toBe(80);
  });
});

describe("stable transforms", () => {
  test("identity transform is stable", () => {
    const result = simulateRepeatedTransform(identityDiagnosticTransform, sample());
    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.amplificationDetected).toBe(false);
    expect(result.iterations).toHaveLength(1);
  });

  test("idempotent transform (set to constant) is stable", () => {
    const setId = (d: Diagnostic): Diagnostic => ({ ...d, score: 100 });
    const result = simulateRepeatedTransform(setId, sample());
    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
  });

  test("idempotent transform (severity bump, already at target) is stable", () => {
    const promote = (d: Diagnostic): Diagnostic => ({
      ...d,
      severity: d.severity === "suggestion" ? "warning" : d.severity,
    });
    const result = simulateRepeatedTransform(promote, sample({ severity: "error" }));
    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
  });

  test("idempotent transform (severity bump, reaches target after 1 iter) is stable", () => {
    const promote = (d: Diagnostic): Diagnostic => ({
      ...d,
      severity: d.severity === "suggestion" ? "warning" : d.severity,
    });
    const result = simulateRepeatedTransform(promote, sample({ severity: "suggestion" }));
    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0]!.iteration).toBe(1);
    expect(result.iterations[1]!.iteration).toBe(2);
  });

  test("conditional transform (fires once then no-op) is stable", () => {
    let fired = false;
    const once: DiagnosticTransform = (d) => {
      if (fired) {
        return d;
      }
      fired = true;
      return { ...d, score: d.score + 10 };
    };
    const result = simulateRepeatedTransform(once, sample());
    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0]!.score).toBe(50);
    expect(result.iterations[1]!.score).toBe(50);
  });
});

// --- pipe vs taggedPipe ---

describe("pipe stability", () => {
  beforeEach(() => {
    resetTransformTracking();
  });

  test("pipe without tagging does NOT provide idempotency", () => {
    const p = pipe(
      (d) => ({ ...d, score: d.score + 5 }),
      (d) => ({ ...d, why: `${d.why} more.` }),
    );
    const result = simulateRepeatedTransform(p, sample());
    expect(result.stable).toBe(false);
    expect(result.converged).toBe(false);
    expect(result.iterations[0]!.score).toBe(45);
    expect(result.iterations[9]!.score).toBe(90);
  });

  test("taggedPipe provides fixpoint convergence", () => {
    const t = taggedPipe({
      transform: (d) => ({ ...d, score: d.score + 10 }),
      axes: ["score"],
      label: "bump",
    });
    const result = simulateRepeatedTransform(t, sample());

    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0]!.score).toBe(50);
    expect(result.iterations[1]!.score).toBe(50);
  });

  test("taggedPipe with multiple transforms converges after first application", () => {
    const t = taggedPipe(
      {
        transform: (d) => ({ ...d, score: d.score + 5 }),
        axes: ["score"],
        label: "bump",
      },
      {
        transform: (d) => ({ ...d, why: `${d.why} extra.` }),
        axes: ["why"],
        label: "explain",
      },
    );
    const result = simulateRepeatedTransform(t, sample());

    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0]!.score).toBe(45);
    expect(result.iterations[0]!.whyLength).toBeGreaterThan(sample().why.length);
    expect(result.iterations[1]!.score).toBe(45);
    expect(result.iterations[1]!.whyLength).toBe(result.iterations[0]!.whyLength);
  });

  test("taggedPipe with non-idempotent inner transform is still safe externally", () => {
    let callCount = 0;
    const t = taggedPipe({
      transform: (d) => {
        callCount++;
        return { ...d, aiHandoff: `${d.aiHandoff} appended.` };
      },
      axes: ["aiHandoff"],
      label: "nonidem",
    });
    const once = t(sample());
    expect(once.aiHandoff).toBe("base handoff appended.");
    expect(callCount).toBe(1);

    const twice = t(once);
    expect(twice.aiHandoff).toBe("base handoff appended.");
    expect(callCount).toBe(1);
  });
});

// --- Composed enrichment pipeline ---

describe("composed enrichment pipeline stability", () => {
  beforeEach(() => {
    resetTransformTracking();
  });

  test("full enrichment pipeline via taggedPipe is stable", () => {
    const pipeline = taggedPipe(
      {
        transform: makePrecedentTransform("precedent"),
        axes: ["why", "aiHandoff"],
        label: "precedent",
      },
      {
        transform: makeConsensusTransform(10, "consensus"),
        axes: ["score", "why", "aiHandoff"],
        label: "consensus",
      },
      {
        transform: makeStackedDiffTransform(5),
        axes: ["score", "why", "aiHandoff"],
        label: "stacked-diff",
      },
    );

    const result = simulateRepeatedTransform(pipeline, sample());
    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0]!.score).toBe(55);
    expect(result.iterations[1]!.score).toBe(55);
  });

  test("untagged pipe of same transforms is unstable", () => {
    const pipeline = pipe(
      makePrecedentTransform("precedent"),
      makeConsensusTransform(10, "consensus"),
      makeStackedDiffTransform(5),
    );

    const result = simulateRepeatedTransform(pipeline, sample());
    expect(result.stable).toBe(false);
    expect(result.converged).toBe(false);
    expect(result.iterations[0]!.score).toBe(55);
    expect(result.iterations[1]!.score).toBe(70);
    expect(result.iterations[9]!.score).toBe(190);
  });
});

// --- Severity promotion stability ---

describe("severity promotion stability", () => {
  function suggestionFinding(overrides: Partial<Diagnostic> = {}): Diagnostic {
    return sample({
      ruleId: "missing-concurrency",
      severity: "suggestion",
      ...overrides,
    });
  }

  test("applySeverityPromotion is idempotent in strict mode", () => {
    const findings = [suggestionFinding()];

    const first = applySeverityPromotion(findings, "strict");
    expect(first[0]!.severity).toBe("warning");

    const second = applySeverityPromotion(first, "strict");
    expect(second).toEqual(first);
  });

  test("applySeverityPromotion in exploratory mode is idempotent (always no-op)", () => {
    const findings = [suggestionFinding()];

    const first = applySeverityPromotion(findings, "exploratory");
    expect(first[0]!.severity).toBe("suggestion");

    const second = applySeverityPromotion(first, "exploratory");
    expect(second).toEqual(first);
  });

  test("applySeverityPromotion is stable: repeated calls don't amplify", () => {
    const findings = [suggestionFinding()];

    let current = findings;
    for (let i = 0; i < 5; i++) {
      current = applySeverityPromotion(current, "strict");
    }

    expect(current[0]!.severity).toBe("warning");
    expect(current[0]!.score).toBe(40);
    expect(current[0]!.why).toBe("base why");
  });
});

// --- Aggregation stability ---

describe("aggregation stability", () => {
  test("aggregateFindingsWithMembers is idempotent", () => {
    const findings = [
      sample({ ruleId: "rule-a", workflow: "ci.yml", score: 30 }),
      sample({ ruleId: "rule-a", workflow: "ci.yml", score: 50 }),
      sample({ ruleId: "rule-b", workflow: "ci.yml", score: 40 }),
    ];

    const first = aggregateFindingsWithMembers(findings);
    const second = aggregateFindingsWithMembers(
      first.aggregatedFindings.flatMap((ag, i) => first.memberFindings[i] ?? []),
    );

    expect(second.aggregatedFindings).toHaveLength(first.aggregatedFindings.length);
    for (const ag of second.aggregatedFindings) {
      const match = first.aggregatedFindings.find(
        (f) => f.ruleId === ag.ruleId && f.workflow === ag.workflow,
      );
      expect(match).toBeDefined();
      expect(ag.messages).toEqual(match!.messages);
      expect(ag.why).toBe(match!.why);
      expect(ag.suggestion).toBe(match!.suggestion);
    }
  });

  test("aggregateFindingsWithMembers produces stable output on re-aggregation", () => {
    const findings = [
      sample({
        ruleId: "rule-a",
        workflow: "ci.yml",
        score: 30,
        location: { path: "ci.yml", line: 1, column: 1 },
      }),
      sample({
        ruleId: "rule-a",
        workflow: "ci.yml",
        score: 50,
        location: { path: "ci.yml", line: 5, column: 1 },
      }),
    ];

    const first = aggregateFindingsWithMembers(findings);
    const memberCount = first.memberFindings.reduce((s, m) => s + m.length, 0);

    const reAgg = aggregateFindingsWithMembers(
      first.aggregatedFindings.flatMap((ag) => findings.filter((f) => f.ruleId === ag.ruleId)),
    );

    expect(reAgg.aggregatedFindings).toHaveLength(first.aggregatedFindings.length);
    const totalMembers = reAgg.memberFindings.reduce((s, m) => s + m.length, 0);
    expect(totalMembers).toBe(memberCount);
  });
});

// --- Edge cases ---

describe("stability edge cases", () => {
  test("zero-score transform with no changes is stable", () => {
    const noop: DiagnosticTransform = (d) => ({ ...d });
    const result = simulateRepeatedTransform(noop, sample());
    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
  });

  test("single-iteration query returns correct result", () => {
    const add = (d: Diagnostic): Diagnostic => ({ ...d, score: d.score + 1 });
    const result = simulateRepeatedTransform(add, sample(), 1);
    expect(result.iterations).toHaveLength(1);
    expect(result.converged).toBe(false);
    expect(result.amplificationDetected).toBe(false);
    expect(result.maxObservedDelta).toBe(0);
  });

  test("oscillating transform is detected as unstable", () => {
    let flip = false;
    const osc: DiagnosticTransform = (d) => {
      flip = !flip;
      return { ...d, score: flip ? 100 : 0 };
    };
    const result = simulateRepeatedTransform(osc, sample());
    expect(result.stable).toBe(false);
    expect(result.converged).toBe(false);
  });

  test("taggedPipe identity is stable", () => {
    const t = taggedPipe();
    const result = simulateRepeatedTransform(t, sample());
    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.iterations).toHaveLength(1);
  });

  test("taggedPipe with only identity transform is stable", () => {
    const t = taggedPipe({
      transform: identityDiagnosticTransform,
      axes: [],
      label: "id",
    });
    const result = simulateRepeatedTransform(t, sample());
    expect(result.stable).toBe(true);
    expect(result.converged).toBe(true);
  });
});
