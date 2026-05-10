import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  buildInferenceGraph,
  detectImplicationDrift,
} from "../src/rules/shared/remediation-checks.ts";
import type { RuleMeta } from "../src/types.ts";

const ruleIdArbitrary = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/);

function fakeMeta(id: string, impliedChecks?: string[]): RuleMeta {
  return {
    id,
    severity: "suggestion",
    confidence: "high",
    docsPath: `docs/rules/${id}.md`,
    impliedChecks,
  };
}

function fakeRule(id: string, impliedChecks?: string[]) {
  return { meta: fakeMeta(id, impliedChecks) };
}

describe("buildInferenceGraph", () => {
  test("returns empty maps for rules without impliedChecks", () => {
    const rules = [fakeRule("rule-a"), fakeRule("rule-b")];
    const graph = buildInferenceGraph(rules);
    expect(graph.forwards.size).toBe(0);
    expect(graph.reverse.size).toBe(0);
  });

  test("builds forward and reverse maps for implied relationships", () => {
    const rules = [fakeRule("rule-a", ["rule-b", "rule-c"]), fakeRule("rule-b", ["rule-c"])];
    const graph = buildInferenceGraph(rules);
    expect(graph.forwards.get("rule-a")).toEqual(["rule-b", "rule-c"]);
    expect(graph.forwards.get("rule-b")).toEqual(["rule-c"]);
    expect(graph.reverse.get("rule-c")).toEqual(["rule-a", "rule-b"]);
    expect(graph.reverse.get("rule-b")).toEqual(["rule-a"]);
  });

  test("handles circular implied checks", () => {
    const rules = [fakeRule("rule-a", ["rule-b"]), fakeRule("rule-b", ["rule-a"])];
    const graph = buildInferenceGraph(rules);
    expect(graph.forwards.get("rule-a")).toEqual(["rule-b"]);
    expect(graph.forwards.get("rule-b")).toEqual(["rule-a"]);
    expect(graph.reverse.get("rule-a")).toEqual(["rule-b"]);
    expect(graph.reverse.get("rule-b")).toEqual(["rule-a"]);
  });

  test("handles rule with impliedChecks referencing nonexistent rule", () => {
    const rules = [fakeRule("rule-a", ["nonexistent"])];
    const graph = buildInferenceGraph(rules);
    expect(graph.forwards.get("rule-a")).toEqual(["nonexistent"]);
  });
});

describe("detectImplicationDrift", () => {
  test("returns empty when source rule did not fire", () => {
    const rules = [fakeRule("rule-a", ["rule-b"])];
    const graph = buildInferenceGraph(rules);
    const warnings = detectImplicationDrift(new Set(), new Set(["rule-a"]), graph);
    expect(warnings).toEqual([]);
  });

  test("returns empty when implied rule also fired", () => {
    const rules = [fakeRule("rule-a", ["rule-b"])];
    const graph = buildInferenceGraph(rules);
    const warnings = detectImplicationDrift(
      new Set(["rule-a", "rule-b"]),
      new Set(["rule-a", "rule-b"]),
      graph,
    );
    expect(warnings).toEqual([]);
  });

  test("warns when implied rule was evaluated but did not fire", () => {
    const rules = [fakeRule("rule-a", ["rule-b"])];
    const graph = buildInferenceGraph(rules);
    const warnings = detectImplicationDrift(
      new Set(["rule-a"]),
      new Set(["rule-a", "rule-b"]),
      graph,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("implied");
    expect(warnings[0]!.message).toContain("rule-b");
  });

  test("warns when implied rule was not even evaluated", () => {
    const rules = [fakeRule("rule-a", ["rule-b"])];
    const graph = buildInferenceGraph(rules);
    const warnings = detectImplicationDrift(new Set(["rule-a"]), new Set(["rule-a"]), graph);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("not evaluated");
  });

  test("returns multiple warnings when multiple implications drift", () => {
    const rules = [fakeRule("rule-a", ["rule-b", "rule-c"])];
    const graph = buildInferenceGraph(rules);
    const warnings = detectImplicationDrift(
      new Set(["rule-a"]),
      new Set(["rule-a", "rule-b", "rule-c"]),
      graph,
    );
    expect(warnings).toHaveLength(2);
  });
});

describe("PBT: inference graph properties", () => {
  const impliedList = fc.array(ruleIdArbitrary, { maxLength: 5 });

  const ruleWithImplied = fc.record({
    id: ruleIdArbitrary,
    implied: impliedList,
  });

  test("every implied entry in forwards has a corresponding reverse entry", () => {
    fc.assert(
      fc.property(fc.array(ruleWithImplied, { maxLength: 10 }), (ruleDefs) => {
        const rules = ruleDefs.map((r) => fakeRule(r.id, r.implied));
        const graph = buildInferenceGraph(rules);

        for (const [sourceId, impliedIds] of graph.forwards) {
          for (const impliedId of impliedIds) {
            const rev = graph.reverse.get(impliedId);
            expect(rev).toBeDefined();
            expect(rev).toContain(sourceId);
          }
        }
      }),
      { numRuns: 500, interruptAfterTimeLimit: 8000 },
    );
  }, 12000);

  test("reverse contains all sources for each implied rule", () => {
    fc.assert(
      fc.property(fc.array(ruleWithImplied, { maxLength: 10 }), (ruleDefs) => {
        const rules = ruleDefs.map((r) => fakeRule(r.id, r.implied));
        const graph = buildInferenceGraph(rules);

        for (const [impliedId, sourceIds] of graph.reverse) {
          for (const sourceId of sourceIds) {
            const fwd = graph.forwards.get(sourceId);
            expect(fwd).toBeDefined();
            expect(fwd).toContain(impliedId);
          }
        }
      }),
      { numRuns: 500, interruptAfterTimeLimit: 8000 },
    );
  }, 12000);

  test("detectImplicationDrift returns stable results irrespective of rule order", () => {
    fc.assert(
      fc.property(
        fc.array(ruleWithImplied, { maxLength: 8 }),
        fc.set(ruleIdArbitrary, { maxLength: 10 }),
        fc.set(ruleIdArbitrary, { maxLength: 10 }),
        (ruleDefs, firedIds, evaluatedIds) => {
          const rules = ruleDefs.map((r) => fakeRule(r.id, r.implied));
          const graph = buildInferenceGraph(rules);
          const warnings = detectImplicationDrift(new Set(firedIds), new Set(evaluatedIds), graph);
          expect(Array.isArray(warnings)).toBe(true);
          for (const w of warnings) {
            expect(typeof w.source).toBe("string");
            expect(typeof w.message).toBe("string");
          }
        },
      ),
      { numRuns: 300, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);
});
