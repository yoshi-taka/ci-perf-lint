import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { isHeavyWorkflow, workflowLooksMetaCheckLike } from "./shared/workflow-jobs.ts";
import {
  withRepositoryPathsFilterPrecedent,
  withSimilarWorkflowPathsFilterConsensus,
} from "./shared/similar-workflow-consensus.ts";
import { getTriggerSemantics } from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import { withStackedDiffContext } from "./shared/stacked-diffs.ts";

const meta = {
  id: "missing-paths-filter",
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/missing-paths-filter.md",
} satisfies RuleMeta;

export const missingPathsFilterRule = {
  meta,
  nodeTypes: ["trigger"],
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const ts = getTriggerSemantics(workflow);

    if ((!ts.hasPullRequest && !ts.hasBranchPush) || ts.hasTagOnlyPush) {
      return [];
    }

    if (
      !isHeavyWorkflow(workflow) ||
      ts.hasTriggerPathFilter ||
      workflowLooksMetaCheckLike(workflow)
    ) {
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
          message:
            "This workflow looks heavy, but push/pull_request do not narrow execution with paths or paths-ignore.",
          why: "Docs-only and unrelated changes are more likely to trigger the same expensive workflow.",
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
