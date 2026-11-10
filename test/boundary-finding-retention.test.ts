import { describe, expect, test } from "bun:test";
import type { AnalysisWarning, Diagnostic } from "../src/types.ts";
import { findingIncludedInMode, findingIncludedInScope } from "../src/repo-finding-utils.ts";
import {
  composePipeline,
  deduplicateRefiner,
  modeFilter,
  repositoryScopeFixMap,
  maxFindingsRefiner,
} from "../src/refiner-pipeline.ts";
import { aggregateFindingsWithMembers } from "../src/reporters-aggregation.ts";
import { applySeverityPromotion } from "../src/severity-promotion.ts";

function finding(token: string, overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    ruleId: "rule-a",
    severity: "warning",
    confidence: "medium",
    scope: "workflow",
    docsPath: "docs/rules/rule-a.md",
    workflow: "ci.yml",
    location: { path: "ci.yml", line: 1, column: 1 },
    message: token,
    why: "reason",
    suggestion: "fix",
    measurementHint: "measure",
    aiHandoff: token,
    score: 50,
    ...overrides,
  };
}

describe("finding retention boundaries", () => {
  test("strict filtering and path:line dedup do not commute", () => {
    const suggestion = finding("suggestion", { severity: "suggestion" });
    const warning = finding("warning", {
      ruleId: "rule-b",
      location: { path: "ci.yml", line: 1, column: 2 },
    });
    const input = [suggestion, warning];
    const dedupFirst = deduplicateRefiner()
      .refine(input, {})
      .filter((d) => findingIncludedInMode(d, "strict"));
    const filterFirst = deduplicateRefiner().refine(
      input.filter((d) => findingIncludedInMode(d, "strict")),
      {},
    );
    expect(dedupFirst).toEqual([]);
    expect(filterFirst).toEqual([warning]);
    // Current documented deduplication policy is rule/column agnostic.
    expect(deduplicateRefiner().refine(input, {})).toEqual([suggestion]);
  });

  test("repository source does not affect scope selection until scope repair", () => {
    const raw = finding("repository", {
      scope: undefined,
      source: {
        kind: "repository",
        workflowPath: "ci.yml",
        location: { path: "ci.yml", line: 1, column: 1 },
      },
    });
    const fixed = repositoryScopeFixMap().map(raw, {});
    expect(findingIncludedInScope(raw, false, true)).toBe(false);
    expect(findingIncludedInScope(fixed, false, true)).toBe(true);
    expect(fixed).toEqual({ ...raw, scope: "repository" });
    expect(repositoryScopeFixMap().map(fixed, {})).toEqual(fixed);
    // The low-level predicate gives workflowOnly precedence if both flags are set.
    expect(findingIncludedInScope(fixed, true, true)).toBe(false);
  });

  test("cap suppression is observable and implied IDs remain uncapped", () => {
    const input = [finding("a1"), finding("a2"), finding("b", { ruleId: "rule-b" })];
    const caps = new Map([
      ["rule-a", 1],
      ["rule-b", 0],
    ]);
    const warnings: AnalysisWarning[] = [];
    const kept = maxFindingsRefiner(caps, new Set(["rule-b"])).refine(input, {
      warnings,
      workflowPath: "ci.yml",
    });
    expect(kept).toEqual([input[0]!, input[2]!]);
    expect(warnings).toEqual([
      {
        kind: "max-findings-hit",
        source: "ci.yml",
        message: "Rule rule-a produced more than 1 findings and 1 were suppressed by maxFindings.",
      },
    ]);
  });

  test("promotion precedes strict selection without mutating the input", () => {
    const fallback = finding("timeout", {
      ruleId: "missing-timeout-minutes",
      severity: "suggestion",
    });
    const regular = finding("other", { severity: "suggestion" });
    const input = [fallback, regular];
    const promoted = applySeverityPromotion(input, "strict");
    const result = composePipeline({
      maps: [repositoryScopeFixMap()],
      filters: [modeFilter("strict")],
    }).refine(promoted, {});
    expect(result).toEqual([{ ...fallback, severity: "warning" }]);
    expect(input.map((d) => d.severity)).toEqual(["suggestion", "suggestion"]);
    const blocked = [fallback, finding("existing warning")];
    expect(applySeverityPromotion(blocked, "strict")).toBe(blocked);
  });

  test("reporter grouping partitions all member occurrences, including duplicates", () => {
    const shared = finding('job "build" first');
    const input = [
      shared,
      shared,
      finding('job "test" second', { workflow: "test.yml" }),
      finding("repository", { scope: "repository", workflow: "package.json" }),
      finding("other rule", { ruleId: "rule-b", docsPath: "docs/rules/rule-b.md" }),
    ];
    const original = structuredClone(input);
    const output = aggregateFindingsWithMembers(input);
    const flattened = output.memberFindings.flat();
    expect(flattened).toHaveLength(input.length);
    for (const d of new Set(input)) {
      expect(flattened.filter((member) => member === d)).toHaveLength(
        input.filter((member) => member === d).length,
      );
    }
    expect(new Set(flattened)).toEqual(new Set(input));
    for (const [i, members] of output.memberFindings.entries()) {
      const group = output.aggregatedFindings[i]!;
      expect(group.firstIndex).toBe(Math.min(...members.map((d) => input.indexOf(d))));
      for (const d of members) {
        expect(group.ruleId).toBe(d.ruleId);
        expect(group.messages).toContain(d.message);
        expect(group.aiHandoffs ?? []).toContain(d.aiHandoff);
      }
    }
    expect(input).toEqual(original);
  });
});
