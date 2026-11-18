import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import {
  withRepositoryPathsFilterPrecedent,
  withSimilarWorkflowPathsFilterConsensus,
} from "./shared/similar-workflow-consensus.ts";
import {
  getTriggerSemantics,
  workflowPullRequestTriggersOnlyOnClosed,
} from "./shared/workflow-triggers.ts";
import { workflowChangeSelectionProducerIds } from "./shared/workflow-jobs.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import { withStackedDiffContext } from "./shared/stacked-diffs.ts";
import { workflowFact, or } from "./shared/predicate.ts";

const meta = {
  id: "missing-paths-filter",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/missing-paths-filter.md",
  skipIf: or(workflowFact("isHeavyWorkflow", false), workflowFact("looksMetaCheckLike", true)),
} satisfies RuleMeta;

/**
 * The workflow runs its own change-based selection: a qualifying producer
 * job (a planner/dorny-paths-filter/determinator job) exposes outputs and a
 * substantial share of jobs consume `needs.<producer>.outputs.*` in their
 * conditions or step environments. Trigger-level paths would duplicate that
 * layer, so the trigger-filter advice abstains (iyi's ci_plan and rue's
 * affected-targets lanes are real examples).
 */
function workflowHasChangeBasedJobSelection(workflow: WorkflowDocument): boolean {
  return workflowChangeSelectionProducerIds(workflow).size > 0;
}

export const missingPathsFilterRule = {
  meta,
  nodeTypes: ["trigger"],
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const ts = getTriggerSemantics(workflow);

    // Tag-only push workflows have no branch-push side to filter, but a
    // pull_request trigger still runs the heavy jobs on every PR.
    if (!ts.hasPullRequest && !ts.hasBranchPush) {
      return [];
    }

    if (workflowPullRequestTriggersOnlyOnClosed(workflow)) {
      return [];
    }

    if (ts.hasTriggerPathFilter) {
      return [];
    }

    // A planner/determinator job already gates which jobs run per change.
    if (workflowHasChangeBasedJobSelection(workflow)) {
      return [];
    }

    return [
      pipe(
        withRepositoryPathsFilterPrecedent(_context, workflow.relativePath),
        withSimilarWorkflowPathsFilterConsensus(_context, workflow.relativePath, {
          scoreBonus: 6,
          why: "That makes this look more like a repository-local trigger-filter gap than a case where the workflow truly needs to run on every change.",
          aiHandoff:
            "Prefer the repository's existing trigger-filter patterns over inventing a new filter shape unless this workflow has clearly different scope requirements.",
        }),
        withStackedDiffContext(_context, {
          scoreBonus: 5,
          why: "Trigger filters can keep unrelated changes in a stack from multiplying expensive workflow runs.",
          aiHandoff:
            "When adding trigger filters, verify required checks do not remain pending for skipped stacked PRs.",
        }),
      )(
        buildDiagnostic(workflow, meta, workflow.onNode ?? workflow.nameNode, {
          message: ts.hasTagOnlyPush
            ? "This workflow looks heavy, and its pull_request trigger does not narrow execution with paths or paths-ignore."
            : "This workflow looks heavy, but push/pull_request do not narrow execution with paths or paths-ignore.",
          why: "Docs-only and unrelated changes are more likely to trigger the same expensive workflow. As pull requests increasingly come from automation and AI-assisted tools, unfiltered triggers scale that waste with the volume of machine-generated PRs.",
          suggestion:
            "Add paths or paths-ignore to focus runs on code changes that actually need this workflow. If branch protection requires this workflow check, prefer keeping the workflow runnable and gating only the heavy jobs inside it.",
          measurementHint:
            "Open a docs-only PR and confirm either the workflow no longer runs unnecessarily or the heavy jobs skip without leaving required checks pending.",
          aiHandoff: `Review trigger filters in ${workflow.relativePath}. If required checks would become pending, keep the workflow runnable and gate only the heavy jobs that do not need docs-only changes.`,
          score: 95,
        }),
      ),
    ];
  },
};
