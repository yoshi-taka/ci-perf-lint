import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowStepTextMatches } from "./shared/workflow-analysis.ts";

// Sources:
// - https://prettier.io/docs/next/integrating-with-linters.html
// - https://zenn.dev/to4_yanagi/articles/98a0246cf46400
const meta = {
  id: "avoid-prettier-eslint",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-prettier-eslint.md",
} satisfies RuleMeta;

export const avoidPrettierEslintRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const repoUsesPrettierEslint = context.repository.prettier.usesPrettierEslint;
    const workflowUsesPrettierEslint = workflowStepTextMatches(workflow, /prettier-eslint/i);
    if (!repoUsesPrettierEslint && !workflowUsesPrettierEslint) {
      return [];
    }
    if (
      repoUsesPrettierEslint &&
      context.repository.primaryWorkflowPath !== undefined &&
      workflow.relativePath !== context.repository.primaryWorkflowPath
    ) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, workflow.root, {
        scope: repoUsesPrettierEslint ? "repository" : "workflow",
        message: repoUsesPrettierEslint
          ? "Repository config or dependencies indicate prettier-eslint is still part of the formatting or linting path."
          : "Workflow text suggests prettier-eslint is still part of the formatting or linting path.",
        why: "Chaining Prettier and ESLint fix behavior through prettier-eslint is usually slower and harder to reason about than keeping formatter and linter steps separate.",
        suggestion:
          "Consider removing prettier-eslint and running Prettier and ESLint as separate commands or CI steps.",
        measurementHint:
          "Compare formatter and lint wall-clock time before and after splitting prettier-eslint into separate commands.",
        aiHandoff:
          "Review repository scripts, dependencies, and CI entrypoints together, and replace prettier-eslint-based formatting flows with separate Prettier and ESLint commands if the wrapper is still in use.",
        score: 56,
      }),
    ];
  },
};
