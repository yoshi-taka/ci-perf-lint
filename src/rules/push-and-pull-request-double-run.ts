import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getTriggerFacts } from "./shared/trigger-facts.ts";
import { workflowFact, or } from "./shared/predicate.ts";

const meta = {
  id: "push-and-pull-request-double-run",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/push-and-pull-request-double-run.md",
  skipIf: or(workflowFact("isHeavyWorkflow", false), workflowFact("looksMetaCheckLike", true)),
} satisfies RuleMeta;

export const pushAndPullRequestDoubleRunRule = {
  meta,
  nodeTypes: ["trigger"],
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const facts = getTriggerFacts(workflow);
    if (!facts.hasPush || !facts.hasPullRequest) {
      return [];
    }

    // Tag-only push never fires for PR branch updates, so there is no duplicate.
    if (facts.push.hasTagOnly) {
      return [];
    }

    // A branches filter scopes push to specific branches; PR branch updates no
    // longer fire the push event, so the duplicate disappears. branches-ignore
    // alone almost never excludes PR branches and does not deduplicate.
    if (facts.push.hasBranches) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, workflow.onNode ?? workflow.nameNode, {
        message:
          "This workflow triggers on both unfiltered branch pushes and pull_request, so a same-repository PR runs it twice for every push.",
        why: "Pushing to the head branch of a same-repository pull request fires both the push and pull_request events, and GitHub Actions does not deduplicate them. Each PR update then pays the full workflow cost twice, which also doubles runner demand on every synchronize.",
        suggestion:
          "Scope push to the integration branch (for example branches: [main]) so PR updates run once, and keep the pull_request side as the required check. Keep unfiltered push only if validating branches without PRs is intentional and the duplicate runs are worth the runner time.",
        measurementHint:
          "Compare workflow run counts and total runner minutes per PR commit before and after scoping push. Confirm required checks still complete on pull_request runs and that pushes without PRs are still covered if they matter.",
        aiHandoff: `Review the triggers in ${workflow.relativePath}. Scope the push trigger to the integration branch so pull_request runs are not duplicated, and verify branch protection still resolves its required checks from the pull_request runs.`,
        score: 57,
      }),
    ];
  },
};
