import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import {
  hasHistoryDependentCommand,
  hasOpaqueRepoScriptExecution,
  isHeavyJob,
  jobIsStaticallyDisabled,
  workflowLooksReleaseLike,
} from "./shared/workflow-jobs.ts";
import { collectScopePrefixes } from "./shared/workflow-path-prefixes.ts";
import { getLoweredWorkflowStepText } from "./shared/workflow-step-text.ts";
import { usesSetupAction } from "./shared/workflow-setup-actions.ts";
import { getCheckoutStep } from "./shared/workflow-analysis.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import { withRepositorySparseCheckoutPrecedent } from "./shared/similar-workflow-consensus.ts";

const meta = {
  id: "prefer-sparse-checkout-for-scoped-workflow",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-sparse-checkout-for-scoped-workflow.md",
} satisfies RuleMeta;

function getCheckoutInput(step: WorkflowStep | undefined, key: string): string | undefined {
  const value = step?.with?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasSparseCheckout(step: WorkflowStep | undefined): boolean {
  return Boolean(getCheckoutInput(step, "sparse-checkout"));
}

function jobUsesLocalAction(job: WorkflowJob): boolean {
  return job.steps.some((step) => (step.uses ?? "").startsWith("./"));
}

function hasDeepHistory(step: WorkflowStep | undefined): boolean {
  const value = step?.with?.["fetch-depth"];
  if (value === 0 || value === "0") {
    return true;
  }
  if (typeof value === "number" && value > 1000) {
    return true;
  }
  if (typeof value === "string" && /^\d{4,}$/.test(value) && Number(value) > 1000) {
    return true;
  }
  return false;
}

function countCheckoutSteps(job: WorkflowJob): number {
  return job.steps.filter((step) => usesSetupAction(step.uses, "actions/checkout@")).length;
}

function hasExplicitFullHistorySignal(
  job: WorkflowJob,
  checkout: WorkflowStep | undefined,
): boolean {
  if (hasDeepHistory(checkout)) {
    return true;
  }

  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /(git\s+log\b|git\s+rev-list\b|git\s+describe\b|git\s+tag\b|previous tag|release notes)/.test(
      text,
    );
  });
}

function hasWideRepoAccess(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /(find\s+\.\b|rg\s+(?:--files\b|\.)|fd\s+\.\b|git\s+grep\b|ls\s+-r\b|du\s+-|turbo\s+run\b|nx\s+affected\b|lerna\b)/.test(
      text,
    );
  });
}

function hasWorkspaceInstall(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /(\bbun\s+install\b|\bnpm\s+(?:ci|install)\b|\bpnpm\s+install\b|\byarn\s+install\b)/.test(
      text,
    );
  });
}

function hasRootQualityGate(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /(\bbun\s+run\s+(?:lint|typecheck|test|check|build)\b|\bnpm\s+run\s+(?:lint|typecheck|test|check|build)\b|\bpnpm\s+run\s+(?:lint|typecheck|test|check|build)\b|\byarn\s+(?:lint|typecheck|test|check|build)\b|\b(?:lint|typecheck|test|check|build)\b)/.test(
      text,
    );
  });
}

function hasOnlyScriptLikeScope(scopePrefixes: string[]): boolean {
  return (
    scopePrefixes.length > 0 &&
    scopePrefixes.every((prefix) => /^(?:script|scripts)\b/.test(prefix))
  );
}

function hasAgenticRepositoryInspection(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = `${step.name ?? ""} ${step.uses ?? ""} ${step.run ?? ""} ${JSON.stringify(
      step.with ?? {},
    )}`.toLowerCase();
    return (
      /(opencode|claude|codex|gemini|ai|agent)/.test(text) &&
      /(commit|changed files|changed|read the changed|review|docs|documentation|packages\/web\/src\/content\/docs)/.test(
        text,
      )
    );
  });
}

function jobLooksAgenticRepositoryInspection(job: WorkflowJob): boolean {
  return hasAgenticRepositoryInspection(job);
}

function jobLooksScopedBuildOrRelease(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  return workflowLooksReleaseLike(workflow, job) || isHeavyJob(job);
}

export const preferSparseCheckoutForScopedWorkflowRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (!jobLooksScopedBuildOrRelease(workflow, job)) {
        continue;
      }

      if (jobIsStaticallyDisabled(job)) {
        continue;
      }

      const checkout = getCheckoutStep(job);
      if (!checkout || hasSparseCheckout(checkout)) {
        continue;
      }

      const scopePrefixes = collectScopePrefixes(job);
      if (scopePrefixes.length === 0 || scopePrefixes.length > 3) {
        continue;
      }

      if (
        hasWideRepoAccess(job) ||
        hasWorkspaceInstall(job) ||
        hasRootQualityGate(job) ||
        jobUsesLocalAction(job)
      ) {
        continue;
      }

      if (hasOnlyScriptLikeScope(scopePrefixes) || hasOpaqueRepoScriptExecution(job)) {
        continue;
      }

      if (jobLooksAgenticRepositoryInspection(job)) {
        continue;
      }

      if (!hasDeepHistory(checkout) && !hasHistoryDependentCommand(job)) {
        continue;
      }

      const usesMultipleCheckouts = countCheckoutSteps(job) >= 2;
      const hasFullHistorySignal = hasExplicitFullHistorySignal(job, checkout);

      findings.push(
        pipe(withRepositorySparseCheckoutPrecedent(_context, workflow.relativePath, job.id))(
          buildDiagnostic(workflow, meta, checkout.withNode ?? checkout.usesNode ?? checkout.node, {
            severity: usesMultipleCheckouts ? "suggestion" : undefined,
            message: hasFullHistorySignal
              ? `Job "${job.id}" appears to keep history available but only a narrow working tree.`
              : usesMultipleCheckouts
                ? `Job "${job.id}" uses a narrow working tree and multiple checkouts, so sparse-checkout may still be worth a manual review.`
                : `Job "${job.id}" uses only a narrow working tree, so sparse-checkout may still be worth testing.`,
            why: hasFullHistorySignal
              ? `This build or release path appears to use only ${scopePrefixes.map((prefix) => `"${prefix}"`).join(", ")}, so sparse-checkout could reduce checkout cost without dropping visible history-aware behavior.`
              : usesMultipleCheckouts
                ? `This build or release path appears to use only ${scopePrefixes.map((prefix) => `"${prefix}"`).join(", ")}, but it also switches branches or re-checks out the repository. Sparse-checkout may still reduce working-tree materialization cost, though this multi-checkout flow needs manual review.`
                : `This build or release path appears to use only ${scopePrefixes.map((prefix) => `"${prefix}"`).join(", ")}, so sparse-checkout could reduce checkout cost. Visible git-sensitive workflow logic exists, but an obvious full-history requirement is not visible here.`,
            suggestion: hasFullHistorySignal
              ? "Keep fetch-depth: 0 if history is required, but add checkout sparse-checkout entries for the visible subtrees this job actually uses."
              : "Add checkout sparse-checkout entries for the visible subtrees this job actually uses, and preserve any branch, release, or git-metadata behavior the workflow depends on.",
            measurementHint: hasFullHistorySignal
              ? "Compare checkout duration, transferred data, and total job time before and after adding sparse-checkout while keeping the same history depth."
              : "Compare checkout duration, transferred data, and total job time before and after adding sparse-checkout, and verify that any branch or release workflow logic still behaves the same.",
            aiHandoff: hasFullHistorySignal
              ? `Review ${workflow.relativePath} job "${job.id}" and consider adding sparse-checkout for the visible working-tree paths it uses while keeping history available if the current release or build logic still needs it.`
              : `Review ${workflow.relativePath} job "${job.id}" and consider adding sparse-checkout for the visible working-tree paths it uses without breaking its branch, release, or git-metadata behavior.`,
            score: usesMultipleCheckouts ? 39 : 72,
          }),
        ),
      );
    }
    return findings;
  },
};
