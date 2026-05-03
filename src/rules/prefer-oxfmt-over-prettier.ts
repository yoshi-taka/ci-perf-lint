import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowStepTextMatches, workflowUsesLintTool } from "./shared/workflow-analysis.ts";

// Sources:
// - https://oxc.rs/docs/guide/usage/formatter
// - https://oxc.rs/docs/guide/usage/formatter/migrate-from-prettier
// - https://oxc.rs/docs/guide/usage/formatter/config-file-reference
const meta = {
  id: "prefer-oxfmt-over-prettier",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-oxfmt-over-prettier.md",
} satisfies RuleMeta;

export const preferOxfmtOverPrettierRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { usesPrettier, usesOxfmt } = context.repository.prettier;
    const workflowUsesPrettier = workflowUsesLintTool(workflow, "prettier");
    const workflowUsesOxfmt = workflowStepTextMatches(
      workflow,
      /(?:^|\s)(?:npx\s+)?oxfmt(?:\s|$)/i,
    );
    if (!workflowUsesPrettier || usesOxfmt || workflowUsesOxfmt) {
      return [];
    }
    if (usesPrettier) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, workflow.root, {
        scope: "workflow",
        message: "Workflow appears to use Prettier without visible Oxfmt adoption.",
        why: "Oxfmt is positioned as a high-performance Prettier-compatible formatter for the JavaScript ecosystem, and its CLI is designed to fit existing Prettier-style format/check workflows with minimal script, CI, and hook changes. The official Prettier migration guide documents `oxfmt --migrate=prettier`, config migration, script and CI updates, plugin limitations, and output differences such as print width defaults.",
        suggestion:
          "Read OXC's 'Migrate from Prettier' guide first, then consider using `oxfmt --migrate=prettier` and replacing the current Prettier entrypoint with Oxfmt to reduce formatter runtime while keeping a drop-in-style migration path.",
        measurementHint:
          "Compare formatting step duration and diff output on the same file set before changing CI defaults.",
        aiHandoff:
          "Start with OXC's 'Migrate from Prettier' guide, review repository formatter scripts, dependencies, CI entrypoints, and hook integrations together, and test whether `oxfmt --migrate=prettier` plus Oxfmt can replace the current Prettier path with equivalent output for the repository's formatted files.",
        score: 48,
      }),
    ];
  },
};
