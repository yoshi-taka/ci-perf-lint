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
  id: "deep-checkout-excessive-depth",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/deep-checkout-excessive-depth.md",
} satisfies RuleMeta;

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

function getFetchDepthValue(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return Number(raw);
  }
  return undefined;
}

export const deepCheckoutExcessiveDepthRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (!usesSetupAction(step.uses, "actions/checkout@")) {
          continue;
        }

        const fetchDepth = getFetchDepthValue(step.with?.["fetch-depth"]);

        if (fetchDepth === undefined) {
          continue;
        }
        if (fetchDepth === 0) {
          continue;
        }
        if (fetchDepth < 1000) {
          continue;
        }

        if (
          hasHistoryDependentCommand(job) ||
          hasOpaqueRepoScriptExecution(job) ||
          jobMayMutateRepository(workflow, job) ||
          workflowLooksReleaseLike(workflow, job) ||
          jobUsesKnownHistoryRequiringAction(job)
        ) {
          continue;
        }

        const fetchTags = step.with?.["fetch-tags"];
        const hasFetchTags = fetchTags === true || fetchTags === "true";

        const message = hasFetchTags
          ? `actions/checkout uses fetch-depth: ${fetchDepth} with fetch-tags in job "${job.id}", but the depth may still be excessive.`
          : `actions/checkout uses fetch-depth: ${fetchDepth} in job "${job.id}", but no history-dependent command was detected.`;

        const why = hasFetchTags
          ? `fetch-depth: ${fetchDepth} transfers a large amount of history even with fetch-tags. A more bounded depth (e.g. 100 or 200) with fetch-tags is usually sufficient for tag resolution.`
          : `fetch-depth: ${fetchDepth} transfers a large amount of history. A depth of 100 or less typically suffices when the job does not need full project history.`;

        const suggestion = hasFetchTags
          ? "Reduce fetch-depth to a lower bounded value (e.g. 100 or 200) while keeping fetch-tags: true. If tags alone drove the depth increase, a much shallower depth with fetch-tags is usually sufficient."
          : "Reduce fetch-depth to a lower bounded value such as 100 or less. If this was set for tag-based versioning or changelog generation, prefer `fetch-tags: true` with a bounded depth instead.";

        findings.push(
          pipe(
            withRepositoryShallowCheckoutPrecedent(_context, workflow.relativePath, job.id),
            withSimilarWorkflowDeepCheckoutConsensus(_context, workflow.relativePath, job.id, {
              scoreBonus: 5,
              why: "That makes this look more like an outlier against the repository's usual shallow-checkout practice than a justified deep-history exception.",
              aiHandoff:
                "Use similar jobs in this repository as the baseline checkout shape before keeping a deep fetch-depth for this one.",
            }),
          )(
            buildDiagnostic(workflow, meta, step.withNode ?? step.usesNode ?? step.node, {
              message,
              why,
              suggestion,
              measurementHint:
                "Compare checkout duration before and after reducing fetch-depth, and verify any tag/version/changelog step still produces the same result.",
              aiHandoff: `Inspect ${workflow.relativePath} job "${job.id}" and consider reducing fetch-depth from ${fetchDepth} to a more bounded value (e.g. 100 or less).`,
              score: 60,
            }),
          ),
        );
      }
    }

    return findings;
  },
};
