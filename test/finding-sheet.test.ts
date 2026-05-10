import { describe, expect, test } from "bun:test";
import {
  buildFindingCore,
  projectToWorkflowSheet,
  projectToRepositorySheet,
  sheetDiagnosticToDiagnostic,
  sheetDiagnosticsToDiagnostics,
  sheetType,
  isWorkflowSheet,
  isRepositorySheet,
  sheetWorkflowPath,
} from "../src/rules/shared/finding-sheet.ts";
import type { RuleMeta } from "../src/types.ts";

const testMeta: RuleMeta = {
  id: "test-missing-concurrency",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/missing-concurrency.md",
};

const deployMeta: RuleMeta = {
  id: "test-deploy-without-timeout",
  severity: "error",
  confidence: "high",
  docsPath: "docs/rules/deploy-without-timeout.md",
};

describe("FindingCore", () => {
  test("buildFindingCore creates semantic identity", () => {
    const core = buildFindingCore(testMeta, {
      evidence: ["no concurrency group configured"],
      rootCause: "ci.yml jobs can run concurrently without coordination",
      category: "reliability",
      location: { path: ".github/workflows/ci.yml", line: 5, column: 1 },
      workflowPath: ".github/workflows/ci.yml",
    });

    expect(core.ruleId).toBe("test-missing-concurrency");
    expect(core.evidence).toEqual(["no concurrency group configured"]);
    expect(core.rootCause).toBe("ci.yml jobs can run concurrently without coordination");
    expect(core.category).toBe("reliability");
    expect(core.locations).toHaveLength(1);
    expect(core.workflowPaths).toEqual([".github/workflows/ci.yml"]);
    expect(core.docsPath).toBe("docs/rules/missing-concurrency.md");
  });
});

describe("Sheet projection", () => {
  const core = buildFindingCore(testMeta, {
    evidence: ["no concurrency group"],
    rootCause: "jobs run without coordination",
    category: "reliability",
    location: { path: ".github/workflows/ci.yml", line: 5, column: 1 },
    workflowPath: ".github/workflows/ci.yml",
  });

  test("projectToWorkflowSheet creates workflow-scope projection", () => {
    const sheet = projectToWorkflowSheet(core, {
      workflow: ".github/workflows/ci.yml",
      message: "Job missing concurrency group",
      why: "Without concurrency, multiple runs can overlap.",
      suggestion: "Add concurrency group.",
      measurementHint: "Check build times with overlapping runs.",
      aiHandoff: "Add concurrency to ci.yml",
      score: 50,
    });

    expect(sheet.type).toBe("workflow");
    expect(sheet.workflow).toBe(".github/workflows/ci.yml");
    expect(sheet.score).toBe(50);
    expect(sheet.severity).toBe("warning");
    expect(sheet.confidence).toBe("high");
  });

  test("projectToRepositorySheet creates repository-scope projection with adjusted score", () => {
    const sheet = projectToRepositorySheet(core, {
      primaryWorkflow: ".github/workflows/ci.yml",
      message: "Repository-wide concurrency inconsistency",
      why: "Multiple workflows lack concurrency groups.",
      suggestion: "Adopt repository-wide concurrency policy.",
      measurementHint: "Check workflow concurrency across all CI files.",
      aiHandoff: "Review concurrency across all workflows.",
      score: 50,
      location: { path: ".github/workflows/ci.yml", line: 1, column: 1 },
    });

    expect(sheet.type).toBe("repository");
    expect(sheet.primaryWorkflow).toBe(".github/workflows/ci.yml");
    expect(sheet.score).toBe(55);
    expect(sheet.severity).toBe("error");
  });

  test("Repository sheet bumps warning to error", () => {
    const sheet = projectToRepositorySheet(core, {
      primaryWorkflow: "ci.yml",
      message: "test",
      why: "test",
      suggestion: "test",
      measurementHint: "test",
      aiHandoff: "test",
      score: 70,
      location: { path: "ci.yml", line: 1, column: 1 },
    });

    expect(sheet.severity).toBe("error");
  });

  test("Repository sheet keeps error as error", () => {
    const errorCore = buildFindingCore(deployMeta, {
      evidence: ["no timeout"],
      rootCause: "deploy can hang",
      category: "reliability",
      location: { path: "deploy.yml", line: 10, column: 1 },
      workflowPath: "deploy.yml",
    });

    const sheet = projectToRepositorySheet(errorCore, {
      primaryWorkflow: "deploy.yml",
      message: "test",
      why: "test",
      suggestion: "test",
      measurementHint: "test",
      aiHandoff: "test",
      score: 80,
      location: { path: "deploy.yml", line: 10, column: 1 },
    });

    expect(sheet.severity).toBe("error");
    expect(sheet.score).toBe(85);
  });
});

describe("SheetDiagnostic conversion", () => {
  const core = buildFindingCore(testMeta, {
    evidence: ["no concurrency"],
    rootCause: "jobs overlap",
    category: "reliability",
    location: { path: "ci.yml", line: 5, column: 1 },
    workflowPath: "ci.yml",
  });

  test("sheetDiagnosticToDiagnostic preserves semantic identity in workflow sheet", () => {
    const ws = projectToWorkflowSheet(core, {
      workflow: "ci.yml",
      message: "Missing concurrency",
      why: "why",
      suggestion: "suggestion",
      measurementHint: "hint",
      aiHandoff: "handoff",
      score: 50,
    });

    const diag = sheetDiagnosticToDiagnostic({ core, sheet: ws });

    expect(diag.ruleId).toBe("test-missing-concurrency");
    expect(diag.scope).toBe("workflow");
    expect(diag.workflow).toBe("ci.yml");
    expect(diag.message).toBe("Missing concurrency");
    expect(diag.score).toBe(50);
    expect(diag.severity).toBe("warning");
    expect(diag.docsPath).toBe("docs/rules/missing-concurrency.md");
  });

  test("sheetDiagnosticToDiagnostic preserves semantic identity in repository sheet", () => {
    const rs = projectToRepositorySheet(core, {
      primaryWorkflow: "ci.yml",
      message: "Repo-wide concurrency issue",
      why: "why",
      suggestion: "suggestion",
      measurementHint: "hint",
      aiHandoff: "handoff",
      score: 50,
      location: { path: "ci.yml", line: 1, column: 1 },
    });

    const diag = sheetDiagnosticToDiagnostic({ core, sheet: rs });

    expect(diag.ruleId).toBe("test-missing-concurrency");
    expect(diag.scope).toBe("repository");
    expect(diag.workflow).toBe("ci.yml");
    expect(diag.message).toBe("Repo-wide concurrency issue");
    expect(diag.score).toBe(55);
    expect(diag.docsPath).toBe("docs/rules/missing-concurrency.md");
  });

  test("sheetDiagnosticsToDiagnostics converts batch", () => {
    const ws = projectToWorkflowSheet(core, {
      workflow: "ci.yml",
      message: "msg1",
      why: "w",
      suggestion: "s",
      measurementHint: "h",
      aiHandoff: "a",
      score: 40,
    });
    const rs = projectToRepositorySheet(core, {
      primaryWorkflow: "ci.yml",
      message: "msg2",
      why: "w",
      suggestion: "s",
      measurementHint: "h",
      aiHandoff: "a",
      score: 40,
      location: { path: "ci.yml", line: 1, column: 1 },
    });

    const diags = sheetDiagnosticsToDiagnostics([
      { core, sheet: ws },
      { core, sheet: rs },
    ]);

    expect(diags).toHaveLength(2);
    expect(diags[0]!.scope).toBe("workflow");
    expect(diags[1]!.scope).toBe("repository");
  });
});

describe("Multi-sheet identity preservation", () => {
  test("Same core, different sheets preserves ruleId and evidence", () => {
    const core = buildFindingCore(testMeta, {
      evidence: ["no concurrency group"],
      rootCause: "jobs overlap",
      category: "reliability",
      location: { path: "ci.yml", line: 5, column: 1 },
      workflowPath: "ci.yml",
    });

    const ws = projectToWorkflowSheet(core, {
      workflow: "ci.yml",
      message: "Missing concurrency in ci.yml",
      why: "why",
      suggestion: "suggestion",
      measurementHint: "hint",
      aiHandoff: "handoff",
      score: 50,
    });

    const rs = projectToRepositorySheet(core, {
      primaryWorkflow: "ci.yml",
      message: "Repository-wide concurrency inconsistency",
      why: "why",
      suggestion: "suggestion",
      measurementHint: "hint",
      aiHandoff: "handoff",
      score: 50,
      location: { path: "ci.yml", line: 1, column: 1 },
    });

    // Same semantic identity
    expect(ws.type).not.toBe(rs.type);
    expect(ws.workflow).toBe("ci.yml");
    expect(rs.primaryWorkflow).toBe("ci.yml");

    // Different projections
    expect(ws.score).not.toBe(rs.score);

    // Same core
    expect(core.ruleId).toBe("test-missing-concurrency");
    expect(core.evidence).toEqual(["no concurrency group"]);
  });

  test("sheetType helper", () => {
    const core = buildFindingCore(testMeta, {
      evidence: ["test"],
      rootCause: "test",
      category: "reliability",
      location: { path: "x.yml", line: 1, column: 1 },
      workflowPath: "x.yml",
    });

    const ws = projectToWorkflowSheet(core, {
      workflow: "x.yml",
      message: "m",
      why: "w",
      suggestion: "s",
      measurementHint: "h",
      aiHandoff: "a",
      score: 10,
    });

    const rs = projectToRepositorySheet(core, {
      primaryWorkflow: "x.yml",
      message: "m",
      why: "w",
      suggestion: "s",
      measurementHint: "h",
      aiHandoff: "a",
      score: 10,
      location: { path: "x.yml", line: 1, column: 1 },
    });

    expect(sheetType({ core, sheet: ws })).toBe("workflow");
    expect(sheetType({ core, sheet: rs })).toBe("repository");
    expect(isWorkflowSheet({ core, sheet: ws })).toBe(true);
    expect(isWorkflowSheet({ core, sheet: rs })).toBe(false);
    expect(isRepositorySheet({ core, sheet: ws })).toBe(false);
    expect(isRepositorySheet({ core, sheet: rs })).toBe(true);
  });

  test("sheetWorkflowPath returns correct path for both sheets", () => {
    const core = buildFindingCore(testMeta, {
      evidence: ["test"],
      rootCause: "test",
      category: "reliability",
      location: { path: "deploy.yml", line: 1, column: 1 },
      workflowPath: "deploy.yml",
    });

    const ws = projectToWorkflowSheet(core, {
      workflow: "deploy.yml",
      message: "m",
      why: "w",
      suggestion: "s",
      measurementHint: "h",
      aiHandoff: "a",
      score: 10,
    });

    const rs = projectToRepositorySheet(core, {
      primaryWorkflow: "deploy.yml",
      message: "m",
      why: "w",
      suggestion: "s",
      measurementHint: "h",
      aiHandoff: "a",
      score: 10,
      location: { path: "deploy.yml", line: 1, column: 1 },
    });

    expect(sheetWorkflowPath({ core, sheet: ws })).toBe("deploy.yml");
    expect(sheetWorkflowPath({ core, sheet: rs })).toBe("deploy.yml");
  });
});
