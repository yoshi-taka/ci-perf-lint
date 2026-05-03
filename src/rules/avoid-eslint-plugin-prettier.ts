import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowStepTextMatches, workflowUsesLintTool } from "./shared/workflow-analysis.ts";

// Sources:
// - https://prettier.io/docs/next/integrating-with-linters.html
// - https://prettier.io/docs/install.html
const meta = {
  id: "avoid-eslint-plugin-prettier",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-eslint-plugin-prettier.md",
} satisfies RuleMeta;

export const avoidEslintPluginPrettierRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const hasWorkflowEvidence =
      workflowUsesLintTool(workflow, "eslint") &&
      workflowStepTextMatches(
        workflow,
        /eslint-plugin-prettier|plugin:prettier\/recommended|prettier\/prettier/i,
      );
    if (!hasWorkflowEvidence) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, workflow.root, {
        scope: "workflow",
        message:
          "Workflow text suggests Prettier is being wired into ESLint through eslint-plugin-prettier style integration.",
        why: "eslint-plugin-prettier style integration runs Prettier through ESLint, which mixes formatting work into the lint path. That usually increases lint runtime and CI noise compared with running Prettier as a separate formatter step.",
        suggestion:
          "Consider removing eslint-plugin-prettier style integration, keep eslint-config-prettier if needed, and run Prettier as a separate formatter step or check.",
        measurementHint:
          "Compare eslint wall-clock time and CI noise before and after removing Prettier-from-ESLint integration, and verify that formatting is still enforced separately.",
        aiHandoff:
          "Review repository ESLint config, package scripts, and CI entrypoints together, and remove Prettier-through-ESLint wiring only if formatting can run as an independent step without losing required checks.",
        score: 58,
      }),
    ];
  },
};
