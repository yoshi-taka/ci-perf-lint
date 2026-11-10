import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowStepTextMatches, workflowUsesLintTool } from "./shared/workflow-analysis.ts";

// Sources:
// - https://bun.com/docs/format
// - https://bun.com/guides/format/migrate-from-prettier
const meta = {
  id: "prefer-bun-fmt-over-prettier",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-bun-fmt-over-prettier.md",
} satisfies RuleMeta;

export const preferBunFmtOverPrettierRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { usesPrettier, usesOxfmt, usesBunFmt } = context.repository.prettier;
    if (context.repository.npm.packageManager !== "bun" || usesOxfmt || usesBunFmt) {
      return [];
    }
    const workflowUsesPrettier = workflowUsesLintTool(workflow, "prettier");
    const workflowUsesBunFmt = workflowStepTextMatches(workflow, /\bbun\s+fmt\b/i);
    if (!workflowUsesPrettier || workflowUsesBunFmt) {
      return [];
    }
    if (usesPrettier) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, workflow.root, {
        scope: "workflow",
        message: "Workflow appears to use Prettier in a Bun repository without visible `bun fmt`.",
        why: "Bun 1.4+ ships a built-in formatter with Prettier-compatible output that reads an existing `.prettierrc` or `.oxfmtrc.json`, so a Bun repository can format without installing Prettier or Oxfmt. `bun fmt --check` works in CI, and `bun fmt --staged` formats staged files without lint-staged.",
        suggestion:
          "Replace the Prettier entrypoint with `bun fmt` (or `bun fmt --check` in CI) after confirming output parity on the repository's files.",
        measurementHint:
          "Compare formatter step duration and diff output on the same file set before changing CI defaults.",
        aiHandoff:
          "Review the formatter scripts, CI steps, and hooks together. Confirm the repository runs Bun 1.4 or newer, verify `bun fmt` output against Prettier on the repository's files, then replace the Prettier entrypoint. If package.json defines a `fmt` script, use `bun fmt --no-script` or rename that script so `bun fmt` runs the built-in formatter.",
        score: 46,
      }),
    ];
  },
};
