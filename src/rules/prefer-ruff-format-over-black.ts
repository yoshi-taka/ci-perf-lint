import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowUsesPythonTool } from "./shared/workflow-analysis.ts";

const meta = {
  id: "prefer-ruff-format-over-black",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-ruff-format-over-black.md",
} satisfies RuleMeta;

export const preferRuffFormatOverBlackRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { usesBlack, usesRuff } = context.repository.python;
    const workflowUsesBlack = workflowUsesPythonTool(workflow, "black");
    const workflowUsesRuff = workflowUsesPythonTool(workflow, "ruff");
    if ((!usesBlack && !workflowUsesBlack) || usesRuff || (!usesBlack && workflowUsesRuff)) {
      return [];
    }
    if (
      usesBlack &&
      context.repository.primaryWorkflowPath !== undefined &&
      workflow.relativePath !== context.repository.primaryWorkflowPath
    ) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, workflow.root, {
        scope: usesBlack ? "repository" : "workflow",
        message: usesBlack
          ? "Repository appears to use Black without visible Ruff formatting adoption."
          : "Workflow appears to use Black without visible Ruff formatting adoption.",
        why: "Ruff can often replace a dedicated Python formatter path with a faster unified toolchain.",
        suggestion:
          "If repository formatting policy allows it, consider replacing Black with ruff format or consolidating formatting under Ruff.",
        measurementHint:
          "Compare formatter step duration and output parity after testing ruff format on the same files.",
        aiHandoff:
          "Review repository Python formatting config, dependencies, and CI entrypoints together, and consider replacing Black with Ruff-based formatting only if style output remains acceptable.",
        score: 46,
      }),
    ];
  },
};
