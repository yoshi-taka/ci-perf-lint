import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { isHeavyWorkflow, workflowLooksMetaCheckLike } from "./shared/workflow-jobs.ts";
import { getTriggerSemantics } from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import {
  withRepositoryNonCodeIgnorePrecedent,
  withSimilarWorkflowNonCodeIgnoreConsensus,
} from "./shared/similar-workflow-consensus.ts";

const meta = {
  id: "missing-path-ignore-for-non-code",
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/missing-path-ignore-for-non-code.md",
} satisfies RuleMeta;

export const missingPathIgnoreForNonCodeRule = {
  meta,
  nodeTypes: ["trigger"],
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const ts = getTriggerSemantics(workflow);

    if ((!ts.hasPullRequest && !ts.hasBranchPush) || ts.hasTagOnlyPush) {
      return [];
    }

    if (
      !isHeavyWorkflow(workflow) ||
      ts.hasNonCodeIgnore ||
      ts.hasTriggerPathFilter ||
      workflowLooksMetaCheckLike(workflow)
    ) {
      return [];
    }

    return [
      pipe(
        withRepositoryNonCodeIgnorePrecedent(_context, workflow.relativePath),
        withSimilarWorkflowNonCodeIgnoreConsensus(_context, workflow.relativePath, {
          scoreBonus: 5,
          why: "That makes this look more like one repository-local exception than an intentional policy to run full CI on docs-only changes.",
          aiHandoff:
            "Prefer the repository's existing non-code ignore conventions over inventing a new ignore list unless this workflow has clearly different scope needs.",
        }),
      )(
        buildDiagnostic(workflow, meta, workflow.onNode ?? workflow.nameNode, {
          message:
            "No docs or markdown-oriented paths-ignore rule was found for push/pull_request.",
          why: "Small documentation-only changes can still trigger expensive CI.",
          suggestion:
            "Consider paths-ignore entries for docs, markdown, and other clearly non-code files. If branch protection requires this workflow check, prefer keeping the workflow runnable and skipping only the heavy jobs.",
          measurementHint:
            "Create a docs-only change and confirm either the heavy workflow is skipped or the expensive jobs are skipped without leaving required checks pending.",
          aiHandoff: `Add safe non-code paths-ignore patterns to ${workflow.relativePath} only if docs-only changes do not need full CI and required checks will not remain pending. Otherwise keep the workflow runnable and gate the heavy jobs inside it.`,
          score: 90,
        }),
      ),
    ];
  },
};
