import { describe, expect, test } from "bun:test";
import { composeDiagnosticSources, diagnosticSourceToRef } from "../src/diagnostic-source.ts";
import { renderAiHandoff, reifyDiagnosticFromSource } from "../src/reification.ts";
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
