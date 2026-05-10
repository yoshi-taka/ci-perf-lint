import { describe, expect, test } from "bun:test";
import type {
  AbstentionReason,
  MeasureCompletenessTracker,
  RuleAbstention,
  EpistemicStatus,
} from "../src/types.ts";

describe("RuleAbstention type and abstain flow", () => {
  test("abstain appends to measureCompleteness.abstentions", () => {
    const mc: MeasureCompletenessTracker = {
      totalWorkflows: 1,
      evaluatedWorkflowPaths: new Set(),
      skippedRepositoryDiagnostics: false,
      skippedGates: new Set(),
      maxFindingsHitRules: new Set(),
      parserFailures: new Set(),
      workflowOnlyRules: new Set(),
      abstentions: [],
      abstain(a: Omit<RuleAbstention, "epistemicStatus">, s: EpistemicStatus = "unknown") {
        this.abstentions.push({ ...a, epistemicStatus: s });
      },
    };

    mc.abstain({ ruleId: "test-rule", jobId: "build", reason: "opaque-body" });
    mc.abstain(
      { ruleId: "test-rule", jobId: "test", reason: "cross-boundary", detail: "reusable workflow" },
      "unknown",
    );
    mc.abstain(
      {
        ruleId: "meta-check",
        jobId: "lint",
        reason: "condition-not-met",
        detail: "not a heavy workflow",
      },
      "known-absent",
    );

    expect(mc.abstentions).toHaveLength(3);

    const first = mc.abstentions[0]!;
    expect(first.ruleId).toBe("test-rule");
    expect(first.jobId).toBe("build");
    expect(first.reason).toBe("opaque-body");
    expect(first.epistemicStatus).toBe("unknown");
    expect(first.detail).toBeUndefined();

    const second = mc.abstentions[1]!;
    expect(second.ruleId).toBe("test-rule");
    expect(second.reason).toBe("cross-boundary");
    expect(second.detail).toBe("reusable workflow");
    expect(second.epistemicStatus).toBe("unknown");

    const third = mc.abstentions[2]!;
    expect(third.ruleId).toBe("meta-check");
    expect(third.reason).toBe("condition-not-met");
    expect(third.epistemicStatus).toBe("known-absent");
  });

  test("no-op abstain when context has no measureCompleteness", () => {
    // RuleContext.abstain is optional; simulate a rule guard that safely calls it
    interface MinimalContext {
      abstain?: (a: Omit<RuleAbstention, "epistemicStatus">, s?: EpistemicStatus) => void;
    }

    const ctx: MinimalContext = {};
    // should not throw
    ctx.abstain?.({ ruleId: "x", jobId: "y", reason: "dynamic-value" });
  });

  test("epistemicStatus = known-absent when skipIf predicate matches", () => {
    // Simulate the pattern: when skipIf fires, record known-absent
    const mc: MeasureCompletenessTracker = {
      totalWorkflows: 0,
      evaluatedWorkflowPaths: new Set(),
      skippedRepositoryDiagnostics: false,
      skippedGates: new Set(),
      maxFindingsHitRules: new Set(),
      parserFailures: new Set(),
      workflowOnlyRules: new Set(),
      abstentions: [],
      abstain(a, s) {
        this.abstentions.push({ ...a, epistemicStatus: s ?? "unknown" });
      },
    };

    // Simulate what the rule engine does when a skipIf matches
    mc.abstain(
      {
        ruleId: "missing-concurrency",
        jobId: "ci",
        reason: "condition-not-met",
        detail: "skipIf: isHeavyWorkflow=false",
      },
      "known-absent",
    );

    expect(mc.abstentions).toHaveLength(1);
    expect(mc.abstentions[0]!.epistemicStatus).toBe("known-absent");
    expect(mc.abstentions[0]!.reason).toBe("condition-not-met");
  });

  test("abstention reasons are enumerable", () => {
    const reasons = [
      "opaque-body",
      "dynamic-value",
      "external-dependency",
      "cross-boundary",
      "condition-not-met",
      "recursion-depth-exceeded",
    ] as const;
    // Verify all are valid AbstentionReason values
    for (const r of reasons) {
      const _: AbstentionReason = r;
      void _;
    }
  });
});
