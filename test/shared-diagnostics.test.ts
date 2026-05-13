import { describe, expect, test } from "bun:test";
import type { Diagnostic, PropagationCluster } from "../src/types.ts";
import { aggregateSharedDiagnostics } from "../src/repository-diagnostics/shared-diagnostics.ts";

function makeDiagnostic(
  ruleId: string,
  workflow: string,
  score: number,
  message = "test finding",
): Diagnostic {
  return {
    ruleId,
    severity: "warning",
    confidence: "high",
    docsPath: `docs/rules/${ruleId}.md`,
    workflow,
    location: { path: workflow, line: 1, column: 1 },
    message,
    why: "test reason",
    suggestion: "fix it",
    measurementHint: "measure this",
    aiHandoff: "handoff text",
    score,
  };
}

interface ClusterOptions {
  ruleId: string;
  sourceWorkflow: string;
  memberWorkflows: string[];
  sourceConfidence?: "high" | "medium" | "low";
  sourceReason?: string;
  edges?: { source: string; target: string; similarity: number }[];
  weightedDiffusionMass?: number;
}

function makeCluster(options: ClusterOptions): PropagationCluster {
  const {
    ruleId,
    sourceWorkflow,
    memberWorkflows,
    sourceConfidence = "high",
    sourceReason = "oldest workflow",
    edges = [],
    weightedDiffusionMass,
  } = options;
  const memberCount = memberWorkflows.length;
  return {
    ruleId,
    sourceWorkflow,
    sourceConfidence,
    sourceReason,
    memberWorkflows,
    memberCount,
    similarityEdges: edges,
    metrics: {
      diffusionCoefficient: memberWorkflows.length / 10,
      weightedDiffusionMass: weightedDiffusionMass ?? memberWorkflows.length * 10,
      propagationDepth: memberWorkflows.length > 2 ? 2 : 0,
      workflowCentrality: 0.5,
    },
  };
}

describe("aggregateSharedDiagnostics", () => {
  test("groups diagnostics by ruleId across workflows", () => {
    const diagnostics: Diagnostic[] = [
      makeDiagnostic("missing-timeout-minutes", "wf1.yml", 5),
      makeDiagnostic("missing-timeout-minutes", "wf2.yml", 7),
      makeDiagnostic("missing-timeout-minutes", "wf3.yml", 3),
    ];

    const clusters: PropagationCluster[] = [
      makeCluster({
        ruleId: "missing-timeout-minutes",
        sourceWorkflow: "wf1.yml",
        memberWorkflows: ["wf1.yml", "wf2.yml", "wf3.yml"],
        sourceConfidence: "high",
        sourceReason: "oldest workflow",
        edges: [
          { source: "wf1.yml", target: "wf2.yml", similarity: 0.8 },
          { source: "wf2.yml", target: "wf3.yml", similarity: 0.7 },
        ],
      }),
    ];

    const result = aggregateSharedDiagnostics(diagnostics, clusters);

    expect(result.shared).toHaveLength(1);
    expect(result.shared[0]!.ruleId).toBe("missing-timeout-minutes");
    expect(result.shared[0]!.memberWorkflows).toEqual(["wf1.yml", "wf2.yml", "wf3.yml"]);
    expect(result.shared[0]!.confidence).toBe("high");
    expect(result.unique).toHaveLength(0);
  });

  test("excludes clusters with fewer than 2 workflows", () => {
    const diagnostics: Diagnostic[] = [makeDiagnostic("missing-timeout-minutes", "wf1.yml", 5)];

    const clusters: PropagationCluster[] = [
      makeCluster({
        ruleId: "missing-timeout-minutes",
        sourceWorkflow: "wf1.yml",
        memberWorkflows: ["wf1.yml"],
      }),
    ];

    const result = aggregateSharedDiagnostics(diagnostics, clusters);

    expect(result.shared).toHaveLength(0);
    expect(result.unique).toHaveLength(1);
  });

  test("keeps unique diagnostics that are not in clusters", () => {
    const diagnostics: Diagnostic[] = [
      makeDiagnostic("missing-timeout-minutes", "wf1.yml", 5),
      makeDiagnostic("missing-timeout-minutes", "wf2.yml", 3),
      makeDiagnostic("different-rule", "wf3.yml", 10),
    ];

    const clusters: PropagationCluster[] = [
      makeCluster({
        ruleId: "missing-timeout-minutes",
        sourceWorkflow: "wf1.yml",
        memberWorkflows: ["wf1.yml", "wf2.yml"],
        sourceConfidence: "high",
      }),
    ];

    const result = aggregateSharedDiagnostics(diagnostics, clusters);

    expect(result.shared).toHaveLength(1);
    expect(result.unique).toHaveLength(1);
    expect(result.unique[0]!.ruleId).toBe("different-rule");
  });

  test("selects highest score diagnostic as representative", () => {
    const diagnostics: Diagnostic[] = [
      makeDiagnostic("missing-timeout-minutes", "wf1.yml", 5),
      makeDiagnostic("missing-timeout-minutes", "wf2.yml", 15, "higher score"),
      makeDiagnostic("missing-timeout-minutes", "wf3.yml", 10),
    ];

    const clusters: PropagationCluster[] = [
      makeCluster({
        ruleId: "missing-timeout-minutes",
        sourceWorkflow: "wf1.yml",
        memberWorkflows: ["wf1.yml", "wf2.yml", "wf3.yml"],
        sourceConfidence: "high",
        sourceReason: "oldest workflow",
      }),
    ];

    const result = aggregateSharedDiagnostics(diagnostics, clusters);

    expect(result.shared[0]!.representativeWorkflow).toBe("wf2.yml");
    expect(result.shared[0]!.representativeMessage).toBe("higher score");
  });

  test("computes correct confidence from multiple factors", () => {
    const diagnostics = [
      makeDiagnostic("rule-a", "wf1.yml", 5),
      makeDiagnostic("rule-a", "wf2.yml", 5),
      makeDiagnostic("rule-a", "wf3.yml", 5),
      makeDiagnostic("rule-a", "wf4.yml", 5),
      makeDiagnostic("rule-a", "wf5.yml", 5),
    ];

    const highConfidenceCluster = makeCluster({
      ruleId: "rule-a",
      sourceWorkflow: "wf1.yml",
      memberWorkflows: ["wf1.yml", "wf2.yml", "wf3.yml", "wf4.yml", "wf5.yml"],
      sourceConfidence: "high",
      sourceReason: "oldest workflow",
      edges: [
        { source: "wf1.yml", target: "wf2.yml", similarity: 0.8 },
        { source: "wf2.yml", target: "wf3.yml", similarity: 0.7 },
        { source: "wf3.yml", target: "wf4.yml", similarity: 0.6 },
        { source: "wf4.yml", target: "wf5.yml", similarity: 0.5 },
      ],
    });

    const result = aggregateSharedDiagnostics(diagnostics, [highConfidenceCluster]);

    expect(result.shared[0]!.confidence).toBe("high");
  });

  test("sorts shared diagnostics by score descending", () => {
    const diagnostics: Diagnostic[] = [
      makeDiagnostic("rule-a", "wf1.yml", 5),
      makeDiagnostic("rule-b", "wf2.yml", 20),
      makeDiagnostic("rule-c", "wf3.yml", 10),
    ];

    const clusters: PropagationCluster[] = [
      makeCluster({
        ruleId: "rule-a",
        sourceWorkflow: "wf1.yml",
        memberWorkflows: ["wf1.yml", "wf2.yml"],
        sourceConfidence: "high",
        weightedDiffusionMass: 20,
      }),
      makeCluster({
        ruleId: "rule-b",
        sourceWorkflow: "wf2.yml",
        memberWorkflows: ["wf2.yml", "wf3.yml", "wf4.yml"],
        sourceConfidence: "high",
        weightedDiffusionMass: 30,
      }),
      makeCluster({
        ruleId: "rule-c",
        sourceWorkflow: "wf3.yml",
        memberWorkflows: ["wf3.yml", "wf1.yml"],
        sourceConfidence: "high",
        weightedDiffusionMass: 20,
      }),
    ];

    const result = aggregateSharedDiagnostics(diagnostics, clusters);

    expect(result.shared.length).toBe(3);
    expect(result.shared[0]!.ruleId).toBe("rule-b");
  });

  test("includes correct why message with member count and source reason", () => {
    const diagnostics = [
      makeDiagnostic("timeout-rule", "wf1.yml", 5),
      makeDiagnostic("timeout-rule", "wf2.yml", 5),
    ];

    const clusters: PropagationCluster[] = [
      makeCluster({
        ruleId: "timeout-rule",
        sourceWorkflow: "wf1.yml",
        memberWorkflows: ["wf1.yml", "wf2.yml"],
        sourceConfidence: "medium",
        sourceReason: "template-like naming",
      }),
    ];

    const result = aggregateSharedDiagnostics(diagnostics, clusters);

    expect(result.shared[0]!.why).toContain("found in 2 workflows");
    expect(result.shared[0]!.why).toContain("template-like naming");
  });
});
