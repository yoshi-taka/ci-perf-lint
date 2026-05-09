import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import {
  hasHistoryDependentCommand,
  hasOpaqueRepoScriptExecution,
  workflowLooksReleaseLike,
} from "./shared/workflow-jobs.ts";
import { usesSetupAction } from "./shared/workflow-setup-actions.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import {
  withRepositoryShallowCheckoutPrecedent,
  withSimilarWorkflowDeepCheckoutConsensus,
} from "./shared/similar-workflow-consensus.ts";
import { jobMayMutateRepository } from "./shared/workflow-mutation.ts";

const meta = {
  id: "deep-checkout-without-need",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/deep-checkout-without-need.md",
  requires: { isHeavy: true },
} satisfies RuleMeta;

function jobUsesNxSetShas(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const uses = step.uses?.toLowerCase() ?? "";
    return uses.startsWith("nrwl/nx-set-shas@");
  });
}

const KNOWN_HISTORY_REQUIRING_ACTIONS = [
  "e18e/action-dependency-diff@",
  "chromaui/action@",
  "lunariajs/action@",
  "goreleaser/goreleaser-action@",
];

function jobUsesKnownHistoryRequiringAction(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const uses = step.uses?.toLowerCase() ?? "";
    return KNOWN_HISTORY_REQUIRING_ACTIONS.some((a) => uses.startsWith(a));
  });
}

export const deepCheckoutWithoutNeedRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (!usesSetupAction(step.uses, "actions/checkout@")) {
          continue;
        }

        const fetchDepth = step.with?.["fetch-depth"];
        const fetchTags = step.with?.["fetch-tags"];

        if (fetchDepth !== 0 && fetchDepth !== "0") {
          continue;
        }

        if (fetchTags === true || fetchTags === "true") {
          continue;
        }

        const usesNxSetShas = jobUsesNxSetShas(job);

        if (
          (hasHistoryDependentCommand(job) && !usesNxSetShas) ||
          hasOpaqueRepoScriptExecution(job) ||
          jobMayMutateRepository(workflow, job) ||
          workflowLooksReleaseLike(workflow, job) ||
          jobUsesKnownHistoryRequiringAction(job)
        ) {
          continue;
        }

        const message = usesNxSetShas
          ? `actions/checkout uses fetch-depth: 0 in job "${job.id}", but nrwl/nx-set-shas computes base SHAs from event metadata — full history is unnecessary.`
          : `actions/checkout uses fetch-depth: 0 in job "${job.id}", but no history-dependent command was detected.`;

        const why = usesNxSetShas
          ? "nrwl/nx-set-shas determines the affected range from the GitHub event payload, not from local git history. A shallow checkout (fetch-depth: 2) is sufficient, making fetch-depth: 0 unnecessary."
          : "Full history checkout (fetch-depth: 0) increases clone time and network usage. In many cases a bounded depth such as 100 or 1000 is sufficient, optionally combined with `fetch-tags: true` for versioning or changelog workflows. This rule only reports when the same job does not visibly run history-dependent git operations, commit-range tooling such as commitlint, release/version/tag logic, opaque repository scripts, or write-capable repository mutation steps.";

        const suggestion = usesNxSetShas
          ? "Replace fetch-depth: 0 with fetch-depth: 2. The default shallow checkout plus nrwl/nx-set-shas provides enough context for nx affected commands."
          : "Confirm whether full history is required. If not, use the default shallow checkout. If this was added for tag-based versioning or changelog generation, prefer `fetch-tags: true` with a bounded `fetch-depth` such as 100 or 1000 where possible. If recent history is required, consider a bounded depth such as 100 or 1000. If history is required but file contents are not needed eagerly, keep the history depth and consider `filter: blob:none` instead.";

        findings.push(
          pipe(
            withRepositoryShallowCheckoutPrecedent(_context, workflow.relativePath, job.id),
            withSimilarWorkflowDeepCheckoutConsensus(
              _context,
              workflow.relativePath,
              job.id,
              {
                scoreBonus: 7,
                why: "That makes this look more like an outlier against the repository's usual shallow-checkout practice than a justified history-heavy exception.",
                aiHandoff:
                  "Use similar jobs in this repository as the baseline checkout shape before keeping full history for this one.",
              },
            ),
          )(
            buildDiagnostic(workflow, meta, step.withNode ?? step.usesNode ?? step.node, {
              message,
              why,
              suggestion,
              measurementHint:
                "Compare checkout duration before and after the change, and verify any tag/version/changelog step still produces the same result.",
              aiHandoff: `Inspect ${workflow.relativePath} job "${job.id}" and evaluate whether fetch-depth: 0 can be replaced with a bounded depth (e.g. 100 or 1000) or fetch-tags: true with a shallower checkout.`,
              score: 70,
            }),
          ),
        );
      }
    }

    return findings;
  },
};
