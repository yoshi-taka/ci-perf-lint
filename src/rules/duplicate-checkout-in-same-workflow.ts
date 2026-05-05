import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { detectInstallCommand } from "./shared/tools.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";
import { getCheckoutStep, hasCheckoutStep } from "./shared/workflow-analysis.ts";

const meta = {
  id: "duplicate-checkout-in-same-workflow",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/duplicate-checkout-in-same-workflow.md",
} satisfies RuleMeta;

interface CheckoutOccurrence {
  jobId: string;
  step: WorkflowStep;
}

export const duplicateCheckoutInSameWorkflowRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const checkoutOccurrences: CheckoutOccurrence[] = [];
    for (const job of workflow.jobs) {
      if (
        job.usesReusableWorkflow ||
        jobHasMatrix(job) ||
        !hasCheckoutStep(job) ||
        !job.steps.some((step) => detectInstallCommand(step) !== undefined)
      ) {
        continue;
      }

      const checkoutStep = getCheckoutStep(job);
      if (!checkoutStep) {
        continue;
      }

      checkoutOccurrences.push({ jobId: job.id, step: checkoutStep });
    }

    if (checkoutOccurrences.length < 2) {
      return [];
    }

    const jobIds = checkoutOccurrences.map((occurrence) => occurrence.jobId).sort();
    const first = checkoutOccurrences[0]!;

    return [
      buildDiagnostic(workflow, meta, first.step.usesNode ?? first.step.node, {
        message: `Multiple jobs (${jobIds.join(", ")}) each perform checkout before dependency installation.`,
        why: "Each GitHub Actions job gets its own runner workspace, so checkout, cache restore, and dependency setup are repeated for every job. When those jobs cover overlapping work, the workflow can pay the same setup cost multiple times without adding much signal.",
        suggestion:
          "Confirm whether these jobs need isolated checkout/setup paths; if the work overlaps, consolidate it, split only the truly different checks, or pass reusable artifacts between jobs.",
        measurementHint:
          "Compare total workflow duration, runner minutes, checkout time, and setup/install time after consolidating one duplicated checkout-heavy path.",
        aiHandoff: `Review ${workflow.relativePath} jobs ${jobIds.join(", ")} for repeated checkout-heavy setup and consolidate only if the jobs are truly overlapping.`,
        score: 57,
      }),
    ];
  },
};
