import type { Node } from "yaml";
import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowUsesLintTool } from "./shared/workflow-analysis.ts";
import {
  eslintVersionSupportsConcurrency,
  textRunsEslintWithoutConcurrency,
} from "./shared/eslint-concurrency.ts";

// Sources:
// - https://eslint.org/blog/2025/08/multithread-linting/
// - https://eslint.org/blog/2025/08/eslint-v9.34.0-released/
const meta = {
  id: "prefer-eslint-concurrency",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-eslint-concurrency.md",
  impliedChecks: ["prefer-oxlint-over-eslint"] as const,
} satisfies RuleMeta;

export const preferEslintConcurrencyRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext): Diagnostic[] {
    const { usesEslint, eslintMajor, eslintMinor } = context.repository.eslint;
    if (!eslintVersionSupportsConcurrency(eslintMajor, eslintMinor)) {
      return [];
    }
    if (!usesEslint && !workflowUsesLintTool(workflow, "eslint")) {
      return [];
    }

    const offendingSteps: { node: Node | undefined }[] = [];
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const text = `${step.name ?? ""} ${step.run ?? ""}`;
        if (textRunsEslintWithoutConcurrency(text)) {
          offendingSteps.push({ node: step.runNode ?? step.node });
        }
      }
    }

    if (offendingSteps.length === 0) {
      return [];
    }

    const first = offendingSteps[0]!;
    return [
      buildDiagnostic(workflow, meta, first.node, {
        message: `Workflow runs ESLint without multithread linting in ${offendingSteps.length} ${offendingSteps.length === 1 ? "step" : "steps"}.`,
        why: "ESLint 9.34 and later can lint files across worker threads with --concurrency. The flag is opt-in and defaults to off, so a lint step that does not pass it stays single-threaded and takes longer on multi-core CI runners. ESLint reports roughly 1.30x to 3.01x speedups on large projects once files are distributed across threads.",
        suggestion:
          "Pass --concurrency=auto to the ESLint invocation, or set a fixed thread count that matches the CI runner cores.",
        measurementHint:
          "Compare the lint step duration before and after adding --concurrency, and test auto against a fixed thread count on the actual CI runner because initialization-heavy configs or limited cores can reduce the gain.",
        aiHandoff: `Review ${workflow.relativePath} and add --concurrency=auto to the ESLint command. Leave the rest of the workflow unchanged and confirm the same files are linted.`,
        score: 40,
      }),
    ];
  },
};
