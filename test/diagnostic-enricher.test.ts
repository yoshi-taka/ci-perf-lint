import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../src/types.ts";
import {
  composeEnrichers,
  contramap,
  toTaggedEnrich,
} from "../src/rules/shared/diagnostic-enricher.ts";
import {
  precedentEnricher,
  consensusEnricher,
  stackedDiffEnricher,
} from "../src/rules/shared/repository-enrichers.ts";

function makeDiagnostic(overrides?: Partial<Diagnostic>): Diagnostic {
  return {
    ruleId: "test-rule",
    severity: "warning",
    confidence: "medium",
    docsPath: "docs/rules/test.md",
    workflow: ".github/workflows/ci.yml",
    location: { path: "ci.yml", line: 1, column: 1 },
    message: "Test finding.",
    why: "Base reason.",
    suggestion: "Fix it.",
    measurementHint: "Measure it.",
    aiHandoff: "Base handoff.",
    score: 50,
    ...overrides,
  };
}

describe("diagnostic-enricher utilities", () => {
  describe("composeEnrichers", () => {
    test("returns identity for empty list", () => {
      const composed = composeEnrichers();
      const d = makeDiagnostic();
      expect(composed.enrich(d, {})).toBe(d);
    });

    test("applies enrichers in order", () => {
      const e1 = {
        label: "add-why",
        axes: [] as const,
        enrich: (d: Diagnostic) => ({ ...d, why: `${d.why} step1` }),
      };
      const e2 = {
        label: "add-why-2",
        axes: [] as const,
        enrich: (d: Diagnostic) => ({ ...d, why: `${d.why} step2` }),
      };
      const composed = composeEnrichers(e1, e2);
      const result = composed.enrich(makeDiagnostic(), {});
      expect(result.why).toBe("Base reason. step1 step2");
    });
  });

  describe("contramap", () => {
    test("projects context from C2 to C1", () => {
      const e1 = {
        label: "greet",
        axes: [] as const,
        enrich: (d: Diagnostic, ctx: { name: string }) => ({
          ...d,
          why: `Hello ${ctx.name}`,
        }),
      };
      const projected = contramap(e1, (ctx: { id: number }) => ({
        name: `user_${ctx.id}`,
      }));
      const result = projected.enrich(makeDiagnostic(), { id: 42 });
      expect(result.why).toBe("Hello user_42");
    });
  });

  describe("precedentEnricher", () => {
    test("appends precedent text when entries exist", () => {
      const d = makeDiagnostic();
      const result = precedentEnricher.enrich(d, {
        entries: [{ workflowPath: "other.yml" }],
        lookups: new Map(),
        workflowPath: "ci.yml",
        label: "concurrency",
        aiHandoff: "Use existing pattern.",
      });
      expect(result.why).toContain("already uses concurrency");
      expect(result.why).toContain("other.yml");
      expect(result.aiHandoff).toContain("Use existing pattern.");
    });

    test("returns unchanged when no entries", () => {
      const d = makeDiagnostic({ why: "Original reason." });
      const result = precedentEnricher.enrich(d, {
        entries: [],
        lookups: new Map(),
        workflowPath: "ci.yml",
        label: "concurrency",
        aiHandoff: "Use existing pattern.",
      });
      expect(result.why).toBe("Original reason.");
      expect(result.aiHandoff).not.toContain("Use existing pattern.");
    });
  });

  describe("consensusEnricher", () => {
    test("adds score and enriches why when signal exists", () => {
      const d = makeDiagnostic({ score: 50 });
      const result = consensusEnricher.enrich(d, {
        signal: { peerCount: 3, peerWorkflowPaths: ["a.yml", "b.yml"] },
        adjustment: { scoreBonus: 8, why: "Consensus found.", aiHandoff: "Match pattern." },
        why: (evidence, peerText) =>
          `In this repository, ${evidence.peerCount} similar workflows already use concurrency.${peerText}`,
        peerText: "Similar workflows already using concurrency include",
        aiHandoff: "Match the established pattern.",
      });
      expect(result.score).toBe(58);
      expect(result.why).toContain("Consensus found.");
      expect(result.why).toContain("3 similar workflows already use concurrency");
    });

    test("returns unchanged when no signal", () => {
      const d = makeDiagnostic({ score: 50 });
      const result = consensusEnricher.enrich(d, {
        signal: undefined,
        adjustment: { scoreBonus: 8, why: "Consensus found.", aiHandoff: "Match." },
        why: () => "unused",
        peerText: "Similar workflows",
        aiHandoff: "Match pattern.",
      });
      expect(result.score).toBe(50);
      expect(result.why).not.toContain("Consensus found.");
    });
  });

  describe("stackedDiffEnricher", () => {
    test("enriches when stacked diffs likely used", () => {
      const d = makeDiagnostic({ score: 50 });
      const result = stackedDiffEnricher.enrich(d, {
        likelyUsed: true,
        evidenceText: "Graphite/stacked diff evidence was found.",
        adjustment: { scoreBonus: 10, why: "Stacked diffs matter.", aiHandoff: "Use groups." },
      });
      expect(result.score).toBe(60);
      expect(result.why).toContain("Stacked diffs matter.");
      expect(result.why).toContain("Graphite/stacked diff evidence");
    });

    test("returns unchanged when not likely used", () => {
      const d = makeDiagnostic({ score: 50 });
      const result = stackedDiffEnricher.enrich(d, {
        likelyUsed: false,
        evidenceText: "unused",
        adjustment: { scoreBonus: 10, why: "Stacked diffs matter.", aiHandoff: "Use groups." },
      });
      expect(result).toBe(d);
    });
  });

  describe("bridge functions", () => {
    test("toTaggedEnrich produces TaggedTransform with correct label and axes", () => {
      const e = {
        label: "my-label",
        axes: ["why"] as const,
        enrich: (d: Diagnostic) => d,
      };
      const tt = toTaggedEnrich(e, {});
      expect(tt.label).toBe("my-label");
      expect(tt.axes).toEqual(["why"]);
    });
  });
});
