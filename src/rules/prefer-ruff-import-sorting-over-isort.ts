import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowUsesPythonTool } from "./shared/workflow-analysis.ts";

const meta = {
  id: "prefer-ruff-import-sorting-over-isort",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-ruff-import-sorting-over-isort.md",
} satisfies RuleMeta;

export const preferRuffImportSortingOverIsortRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { usesIsort, usesRuff } = context.repository.python;
    const workflowUsesIsort = workflowUsesPythonTool(workflow, "isort");
    const workflowUsesRuff = workflowUsesPythonTool(workflow, "ruff");
    if ((!usesIsort && !workflowUsesIsort) || usesRuff || (!usesIsort && workflowUsesRuff)) {
      return [];
    }
    if (
      usesIsort &&
      context.repository.primaryWorkflowPath !== undefined &&
      workflow.relativePath !== context.repository.primaryWorkflowPath
    ) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, workflow.root, {
        scope: usesIsort ? "repository" : "workflow",
        message: usesIsort
          ? "Repository appears to use isort without visible Ruff import-sorting adoption."
          : "Workflow appears to use isort without visible Ruff import-sorting adoption.",
        why: "Ruff can often cover import sorting in the same toolchain used for other Python checks.",
        suggestion:
          "If repository lint policy allows it, consider replacing isort with ruff check --select I or consolidating import sorting under Ruff.",
        measurementHint:
          "Compare import-sorting step duration and diff output after testing Ruff on the same files.",
        aiHandoff:
          "Review repository Python import-sorting config, dependencies, and CI entrypoints together, and consider replacing isort with Ruff-based import sorting only if the repository's import style remains acceptable.",
        score: 47,
      }),
    ];
  },
};
