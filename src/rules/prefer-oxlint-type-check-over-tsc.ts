import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  oxlintTypeCheckMeasurementHint,
  oxlintTypeCheckSuggestion,
  oxlintTypeCheckWhy,
  textRunsTscTypeCheck,
} from "./shared/oxlint-type-check.ts";

// Sources:
// - https://oxc.rs/docs/guide/usage/linter/type-aware
// - https://oxc.rs/blog/2026-07-22-type-aware-linting-stable
const meta = {
  id: "prefer-oxlint-type-check-over-tsc",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-oxlint-type-check-over-tsc.md",
} satisfies RuleMeta;

function stepRunsTscTypeCheck(step: WorkflowStep): boolean {
  return textRunsTscTypeCheck(`${step.name ?? ""} ${step.run ?? ""}`);
}

function collectOffendingSteps(job: WorkflowJob): WorkflowStep[] {
  return job.steps.filter((step) => stepRunsTscTypeCheck(step));
}

export const preferOxlintTypeCheckOverTscRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (!context.repository.eslint.usesOxlint) {
      return [];
    }

    const suggestion = oxlintTypeCheckSuggestion(context.repository);

    return workflow.jobs
      .filter((job) => !job.usesReusableWorkflow)
      .flatMap((job) => {
        const offendingSteps = collectOffendingSteps(job);
        const anchor = offendingSteps[0];
        if (!anchor) {
          return [];
        }

        const stepNames = offendingSteps.map((step) => step.name ?? step.run ?? "").join(", ");

        return [
          buildDiagnostic(workflow, meta, anchor.runNode ?? anchor.node, {
            message: `Job "${job.id}" runs a separate tsc type-check (${stepNames}) while the repository uses oxlint.`,
            why: oxlintTypeCheckWhy,
            suggestion,
            measurementHint: oxlintTypeCheckMeasurementHint,
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Confirm oxlint and oxlint-tsgolint are current, then replace the separate tsc type-check step with \`oxlint --type-aware --type-check\` on the lint step and remove the redundant tsc invocation. Keep any declaration/build emit that is separate from type checking.`,
            score: 47,
          }),
        ];
      });
  },
};
