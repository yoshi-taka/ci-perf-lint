import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowUsesLintTool } from "./shared/workflow-analysis.ts";
import { getSignalSets, setDifference } from "../repository-signals-utils.ts";

// Sources:
// - https://oxc.rs/docs/guide/usage/linter.html
// - https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint.html
// - https://oxc.rs/docs/guide/usage/linter/plugins
// - https://oxc.rs/docs/guide/usage/linter/js-plugins
const meta = {
  id: "prefer-oxlint-over-eslint",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-oxlint-over-eslint.md",
  impliedChecks: ["prefer-oxfmt-over-prettier"],
} satisfies RuleMeta;

export const preferOxlintOverEslintRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { usesEslint, usesOxlint, unsupportedPluginNames, usesCustomExtensions } =
      context.repository.eslint;
    const workflowUsesEslint = workflowUsesLintTool(workflow, "eslint");
    const workflowUsesOxlint = workflowUsesLintTool(workflow, "oxlint");
    if ((!usesEslint && !workflowUsesEslint) || usesOxlint || workflowUsesOxlint) {
      return [];
    }
    if (
      usesEslint &&
      context.repository.primaryWorkflowPath !== undefined &&
      workflow.relativePath !== context.repository.primaryWorkflowPath
    ) {
      return [];
    }

    const sets = getSignalSets(context.repository);
    const compatiblePluginNames = [
      ...setDifference(sets.eslint.pluginNames, sets.eslint.unsupportedPluginNames),
    ];
    const severity =
      unsupportedPluginNames.length > 0 || usesCustomExtensions ? "suggestion" : "warning";
    const confidence = "medium";
    const compatibilityNote =
      severity === "warning"
        ? compatiblePluginNames.length > 0
          ? `Visible ESLint plugins look compatible with Oxlint built-ins: ${compatiblePluginNames.join(", ")}.`
          : "No visible unsupported ESLint plugin dependencies were detected at the repository root."
        : unsupportedPluginNames.length > 0
          ? `Repository-level ESLint plugins may need extra migration review: ${unsupportedPluginNames.join(", ")}.`
          : "Repository-level ESLint config appears to use custom extensions or local rule wiring.";

    return [
      buildDiagnostic(workflow, meta, workflow.root, {
        severity,
        confidence,
        scope: usesEslint ? "repository" : "workflow",
        message: usesEslint
          ? "Repository appears to use ESLint without visible Oxlint adoption."
          : "Workflow appears to use ESLint without visible Oxlint adoption.",
        why: `Oxlint is often a drop-in or front-of-line speedup for JavaScript and TypeScript lint paths in CI. The official ESLint migration guide also documents incremental adoption, config migration, JS plugin fallback, and staged Oxlint-plus-ESLint rollouts. ${compatibilityNote}`,
        suggestion:
          severity === "warning"
            ? "Read OXC's 'Migrate from ESLint' guide first, then consider migrating the current ESLint entrypoint with @oxlint/migrate or running Oxlint before ESLint for a staged rollout."
            : "Read OXC's 'Migrate from ESLint' guide first, then evaluate Oxlint for the current lint path while verifying plugin, JS plugin, and custom-rule compatibility before replacing or fronting ESLint.",
        measurementHint:
          "Compare lint wall-clock time and rule coverage on the same target files before changing CI defaults.",
        aiHandoff:
          severity === "warning"
            ? "Start with OXC's 'Migrate from ESLint' guide, review repository lint scripts, package dependencies, and CI entrypoints together, and test whether @oxlint/migrate or an oxlint-then-eslint staged rollout can replace or front the current ESLint path without losing required coverage."
            : "Start with OXC's 'Migrate from ESLint' guide, review repository lint scripts, package dependencies, JS plugin needs, and custom ESLint behavior together, and only introduce Oxlint after confirming compatibility for the current rule set.",
        score: severity === "warning" ? 49 : 34,
      }),
    ];
  },
};
