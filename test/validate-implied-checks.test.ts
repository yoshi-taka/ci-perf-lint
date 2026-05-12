import { describe, expect, test } from "bun:test";
import type { RuleMeta } from "../src/types.ts";
import { validateImpliedChecks } from "../src/rules/validate-implied-checks.ts";
import { allRules } from "../src/rules/index.ts";
import { repositoryDiagnosticCollectors } from "../src/repository-diagnostics/index.ts";

function fakeMeta(id: string, impliedChecks?: string[]): RuleMeta {
  return {
    id,
    severity: "warning",
    confidence: "medium",
    docsPath: "docs/rules/test.md",
    impliedChecks,
  };
}

function fakeRule(id: string, impliedChecks?: string[]) {
  return { meta: fakeMeta(id, impliedChecks) };
}

describe("validateImpliedChecks", () => {
  test("returns valid for rules without impliedChecks", () => {
    const rules = [fakeRule("rule-a"), fakeRule("rule-b")];
    const result = validateImpliedChecks(rules);
    expect(result.valid).toBe(true);
    expect(result.missingTargets).toEqual([]);
  });

  test("returns valid when all impliedChecks reference existing rules", () => {
    const rules = [fakeRule("rule-a", ["rule-b"]), fakeRule("rule-b")];
    const result = validateImpliedChecks(rules);
    expect(result.valid).toBe(true);
  });

  test("detects missing implied check targets", () => {
    const rules = [fakeRule("rule-a", ["rule-nonexistent"]), fakeRule("rule-b")];
    const result = validateImpliedChecks(rules);
    expect(result.valid).toBe(false);
    expect(result.missingTargets).toHaveLength(1);
    expect(result.missingTargets[0]).toEqual({
      sourceId: "rule-a",
      targetId: "rule-nonexistent",
    });
  });

  test("detects multiple missing targets", () => {
    const rules = [fakeRule("rule-a", ["missing-1", "missing-2"])];
    const result = validateImpliedChecks(rules);
    expect(result.valid).toBe(false);
    expect(result.missingTargets).toHaveLength(2);
  });

  test("detects cycles in implied checks", () => {
    const rules = [fakeRule("rule-a", ["rule-b"]), fakeRule("rule-b", ["rule-a"])];
    const result = validateImpliedChecks(rules);
    expect(result.valid).toBe(false);
  });

  test("all production rules pass validation when combined with repo diagnostics", () => {
    const repoIds = repositoryDiagnosticCollectors.map((c) => c.id);
    const result = validateImpliedChecks(
      allRules.map((r) => ({ meta: r.meta as RuleMeta })),
      repoIds,
    );
    expect(result.valid).toBe(true);
  });
});
