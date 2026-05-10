import { describe, expect, test } from "bun:test";
import { composeDiagnosticSources, diagnosticSourceToRef } from "../src/diagnostic-source.ts";
import {
  renderAiHandoff,
  reifyDiagnosticFromSource,
  createLegacyDetails,
  createBlueprintDetails,
  foldDiagnosticDetails,
  getDetailTag,
} from "../src/reification.ts";
import type { DiagnosticBlueprint } from "../src/reification.ts";
import type { RuleMeta } from "../src/types.ts";

const meta: RuleMeta = {
  id: "source-rule",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/source-rule.md",
};

const blueprint: DiagnosticBlueprint = {
  message: "msg",
  why: "why",
  measurementHint: "measure",
  repair: {
    action: "review",
    scope: "workflow",
    target: "workflow",
    detail: "check provenance",
  },
  score: 1,
};

describe("diagnostic provenance", () => {
  test("reifyDiagnosticFromSource preserves workflow provenance", () => {
    const diagnostic = reifyDiagnosticFromSource(
      meta,
      {
        kind: "workflow",
        workflowPath: "wf.yml",
        location: { path: "wf.yml", line: 1, column: 1 },
      },
      undefined,
      blueprint,
    );

    expect(diagnostic.workflow).toBe("wf.yml");
    expect(diagnostic.source.kind).toBe("workflow");
    expect(diagnostic.source.workflowPath).toBe("wf.yml");
  });

  test("composite provenance is retained in ai handoff rendering", () => {
    const source = composeDiagnosticSources(
      {
        kind: "workflow",
        workflowPath: "wf.yml",
        location: { path: "wf.yml", line: 1, column: 1 },
      },
      {
        kind: "repository",
        workflowPath: "repo.yml",
        location: { path: "Dockerfile", line: 3, column: 1 },
      },
    );

    expect(diagnosticSourceToRef(source)).toEqual({
      kind: "composite",
      sources: [
        {
          kind: "workflow",
          workflowPath: "wf.yml",
          location: { path: "wf.yml", line: 1, column: 1 },
        },
        {
          kind: "repository",
          workflowPath: "repo.yml",
          location: { path: "Dockerfile", line: 3, column: 1 },
        },
      ],
    });

    expect(renderAiHandoff(blueprint.repair, meta.id, source)).toContain("wf.yml");
    expect(renderAiHandoff(blueprint.repair, meta.id, source)).toContain("repo.yml");
  });
});

describe("diagnostic details tagged union", () => {
  test("createLegacyDetails creates tagged legacy details", () => {
    const details = createLegacyDetails({
      message: "test message",
      why: "test why",
      suggestion: "test suggestion",
      measurementHint: "test hint",
      aiHandoff: "test handoff",
      score: 50,
    });

    expect(details._tag).toBe("legacy");
    expect(details.message).toBe("test message");
    expect(getDetailTag(details)).toBe("legacy");
  });

  test("createBlueprintDetails creates tagged blueprint details", () => {
    const details = createBlueprintDetails({
      message: "test message",
      why: "test why",
      repair: { action: "add", scope: "workflow", target: "test" },
      measurementHint: "test hint",
      score: 50,
    });

    expect(details._tag).toBe("blueprint");
    expect(details.message).toBe("test message");
    expect(getDetailTag(details)).toBe("blueprint");
  });

  test("foldDiagnosticDetails exhaustively handles all variants", () => {
    const legacyDetails = createLegacyDetails({
      message: "legacy",
      why: "why",
      suggestion: "fix",
      measurementHint: "hint",
      aiHandoff: "handoff",
      score: 50,
    });

    const blueprintDetails = createBlueprintDetails({
      message: "blueprint",
      why: "why",
      repair: { action: "review", scope: "workflow", target: "x" },
      measurementHint: "hint",
      score: 50,
    });

    const legacyResult = foldDiagnosticDetails(legacyDetails, {
      onLegacy: (d) => `legacy:${d.message}`,
      onBlueprint: (d) => `blueprint:${d.message}`,
    });

    const blueprintResult = foldDiagnosticDetails(blueprintDetails, {
      onLegacy: (d) => `legacy:${d.message}`,
      onBlueprint: (d) => `blueprint:${d.message}`,
    });

    expect(legacyResult).toBe("legacy:legacy");
    expect(blueprintResult).toBe("blueprint:blueprint");
  });

  test("tagged union is exhaustive for future variants", () => {
    const details = createLegacyDetails({
      message: "test",
      why: "why",
      suggestion: "fix",
      measurementHint: "hint",
      aiHandoff: "handoff",
      score: 50,
    });

    const tags: string[] = [];
    foldDiagnosticDetails(details, {
      onLegacy: (d) => {
        tags.push("legacy");
        expect(d.message).toBe("test");
      },
      onBlueprint: (_d) => {
        tags.push("blueprint");
      },
    });
    expect(tags).toEqual(["legacy"]);
  });
});
