import { describe, it, expect } from "bun:test";
import {
  validateImplications,
  computeScheduling,
  buildImplicationObservability,
} from "../src/rule-engine/implication.ts";
import type { RuleMeta } from "../src/types.ts";
import { buildInferenceGraph } from "../src/rules/shared/remediation-checks.ts";

describe("RuleImplication", () => {
  describe("validateImplications", () => {
    it("detects cycle in implications", () => {
      const rules: { meta: RuleMeta }[] = [
        {
          meta: {
            id: "a",
            severity: "error",
            confidence: "high",
            docsPath: "docs/a.md",
            implications: [{ type: "semantic-implies", source: "a", target: "b" }],
          },
        },
        {
          meta: {
            id: "b",
            severity: "error",
            confidence: "high",
            docsPath: "docs/b.md",
            implications: [{ type: "semantic-implies", source: "b", target: "a" }],
          },
        },
      ];
      const result = validateImplications(rules);
      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it("detects missing target", () => {
      const rules: { meta: RuleMeta }[] = [
        {
          meta: {
            id: "a",
            severity: "error",
            confidence: "high",
            docsPath: "docs/a.md",
            implications: [{ type: "semantic-implies", source: "a", target: "nonexistent" }],
          },
        },
      ];
      const result = validateImplications(rules);
      expect(result.valid).toBe(false);
      expect(result.missingTargets).toEqual([{ sourceId: "a", targetId: "nonexistent" }]);
    });

    it("coexists with impliedChecks (backward compat)", () => {
      const rules: { meta: RuleMeta }[] = [
        {
          meta: {
            id: "a",
            severity: "error",
            confidence: "high",
            docsPath: "docs/a.md",
            impliedChecks: ["b"],
            implications: [{ type: "semantic-implies", source: "a", target: "c" }],
          },
        },
        {
          meta: {
            id: "b",
            severity: "warning",
            confidence: "high",
            docsPath: "docs/b.md",
          },
        },
        {
          meta: {
            id: "c",
            severity: "warning",
            confidence: "high",
            docsPath: "docs/c.md",
          },
        },
      ];
      const graph = buildInferenceGraph(rules);
      const edges = graph.forwards.get("a") ?? [];
      expect(edges).toContain("b");
      expect(edges).toContain("c");
    });

    it("excludes ordering type from inference graph", () => {
      const rules: { meta: RuleMeta }[] = [
        {
          meta: {
            id: "a",
            severity: "error",
            confidence: "high",
            docsPath: "docs/a.md",
            implications: [
              { type: "ordering", source: "a", target: "b" },
              { type: "semantic-implies", source: "a", target: "c" },
            ],
          },
        },
        { meta: { id: "b", severity: "warning", confidence: "high", docsPath: "docs/b.md" } },
        { meta: { id: "c", severity: "warning", confidence: "high", docsPath: "docs/c.md" } },
      ];
      const graph = buildInferenceGraph(rules);
      const edges = graph.forwards.get("a") ?? [];
      expect(edges).toContain("c");
      expect(edges).not.toContain("b");
    });
  });

  describe("computeScheduling", () => {
    it("orders by topological sort", () => {
      const rules: { meta: RuleMeta }[] = [
        {
          meta: {
            id: "a",
            severity: "error",
            confidence: "high",
            docsPath: "docs/a.md",
            scheduling: { ordering: [["a", "b"]] },
          },
        },
        {
          meta: {
            id: "b",
            severity: "error",
            confidence: "high",
            docsPath: "docs/b.md",
          },
        },
      ];
      const result = computeScheduling(rules, new Set());
      const flatOrder = result.orderedRanks.flat();
      expect(flatOrder.indexOf("a")).toBeLessThan(flatOrder.indexOf("b"));
    });

    it("prunes on mutual exclusion when source fired", () => {
      const rules: { meta: RuleMeta }[] = [
        {
          meta: {
            id: "a",
            severity: "error",
            confidence: "high",
            docsPath: "docs/a.md",
            scheduling: { mutualExclusion: [["a", "b"] as [string, string]] },
          },
        },
        {
          meta: {
            id: "b",
            severity: "error",
            confidence: "high",
            docsPath: "docs/b.md",
          },
        },
      ];
      const result = computeScheduling(rules, new Set(["a"]));
      expect(result.skipped).toEqual([{ ruleId: "b", reason: "mutual-exclusion: a fired" }]);
    });
  });

  describe("buildImplicationObservability", () => {
    it("produces observability data", () => {
      const rules: { meta: RuleMeta }[] = [
        {
          meta: {
            id: "a",
            severity: "error",
            confidence: "high",
            docsPath: "docs/a.md",
            impliedChecks: ["b"],
          },
        },
        {
          meta: {
            id: "b",
            severity: "warning",
            confidence: "high",
            docsPath: "docs/b.md",
          },
        },
      ];
      const graph = buildInferenceGraph(rules);
      const scheduling = computeScheduling(rules, new Set(["a"]));
      const obs = buildImplicationObservability(graph, scheduling);

      expect(obs.activeImplications).toEqual([
        { source: "a", target: "b", type: "semantic-implies" },
      ]);
      expect(obs.evaluationOrder).toEqual([]);
    });
  });
});
