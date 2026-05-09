import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RuleMeta } from "../types.ts";
import {
  isHeavyWorkflow,
  workflowLooksAgenticLike,
  workflowHasConcurrency,
} from "./shared/workflow-jobs.ts";
import {
  workflowHasPullRequestTrigger,
  workflowHasPushTrigger,
  workflowHasTagOnlyPushTrigger,
  workflowHasTriggerPathFilter,
} from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import {
  withRepositoryConcurrencyPrecedent,
  withSimilarWorkflowConcurrencyConsensus,
} from "./shared/similar-workflow-consensus.ts";
import { withStackedDiffContext } from "./shared/stacked-diffs.ts";

const meta = {
  id: "missing-concurrency",
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/missing-concurrency.md",
  maxFindings: 3,
  requires: { isHeavy: true },
  impliedChecks: ["missing-timeout-minutes"],
} satisfies RuleMeta;

export const missingConcurrencyRule = {
  meta,
  nodeTypes: ["trigger"],
  check(workflow: WorkflowDocument, context: RuleContext) {
    const hasPullRequest = workflowHasPullRequestTrigger(workflow);
    const hasPush = workflowHasPushTrigger(workflow);
    const hasNarrowTrigger = workflowHasTriggerPathFilter(workflow);

    if (!hasPullRequest && !hasPush) {
      return [];
    }

    if (!hasPullRequest && workflowHasTagOnlyPushTrigger(workflow)) {
      return [];
    }

    if (!hasPullRequest && hasPush && hasNarrowTrigger) {
      return [];
    }

    const agentic = workflowLooksAgenticLike(workflow);

    if (!isHeavyWorkflow(workflow) || workflowHasConcurrency(workflow)) {
      return [];
    }

    const base = buildDiagnostic(workflow, meta, workflow.onNode ?? workflow.nameNode, {
      message: "The workflow has no workflow-level or job-level concurrency setting.",
      severity: agentic ? "warning" : undefined,
      why: agentic
        ? "Agentic and AI-assisted runs are often long-lived, so older runs can keep burning runner time after newer commits or comments arrive on the same PR or branch."
        : "Older runs can continue burning runner time after newer commits arrive on the same PR or branch.",
      suggestion: "Add concurrency with cancel-in-progress for pull_request or branch-scoped runs.",
      measurementHint:
        "Push multiple commits to the same PR and confirm only the latest run continues.",
      aiHandoff: `Add safe concurrency to ${workflow.relativePath}, ideally scoped by workflow and ref, and keep existing behavior intact.`,
      score: agentic ? 62 : 58,
    });

    const transform = pipe(
      withRepositoryConcurrencyPrecedent(context, workflow.relativePath),
      withSimilarWorkflowConcurrencyConsensus(context, workflow.relativePath, {
        scoreBonus: 8,
        why: "That makes this look more like a repository-local normalization gap than a one-off design choice.",
        aiHandoff:
          "Prefer the repository's existing concurrency pattern over inventing a new grouping strategy unless this workflow has clearly different cancellation requirements.",
      }),
      withStackedDiffContext(context, {
        scoreBonus: 10,
        why: "Concurrency is more valuable because superseded runs from restacks can otherwise keep consuming runner time.",
        aiHandoff:
          "Use a concurrency group scoped to the workflow and PR/head ref so newer restack runs cancel older runs from the same branch without canceling unrelated PRs.",
      }),
    );

    return [transform(base)];
  },
};
