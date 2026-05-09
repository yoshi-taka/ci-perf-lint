import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RuleContext } from "../rule-engine.ts";
import {
  hasDirectHeavySignals,
  isHeavyJob,
  workflowHasConcurrency,
  workflowJobCount,
} from "./shared/workflow-jobs.ts";
import {
  workflowHasPullRequestTrigger,
  workflowHasPushTrigger,
  workflowHasTriggerPathFilter,
} from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import { withStackedDiffContext } from "./shared/stacked-diffs.ts";

const meta = {
  id: "ungated-heavy-job",
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/ungated-heavy-job.md",
} satisfies RuleMeta;

export const ungatedHeavyJobRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (!context.repository.looksLargeOrComplex) {
      return [];
    }

    if (!workflowHasPullRequestTrigger(workflow) && !workflowHasPushTrigger(workflow)) {
      return [];
    }

    return workflow.jobs
      .filter((job) => isHeavyJob(job) && hasDirectHeavySignals(job) && !job.hasIf)
      .map((job) =>
        pipe(
          withStackedDiffContext(context, {
            scoreBonus: 8,
            why: "Heavy untiered jobs are stronger candidates for fast/slow CI separation when upstack PRs can be rerun by restacks.",
            aiHandoff:
              "Consider whether this job should be part of an always-on fast check or a slower gated check for merge queue, labels, manual dispatch, or a stack-aware optimizer.",
          }),
        )(
          buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
            message: `Job "${job.id}" looks heavy and has no visible job-level gating.`,
            why: `Expensive jobs can still run on changes that do not need them, even when workflow-level safeguards such as ${
              workflowHasTriggerPathFilter(workflow) ? "trigger filters" : "broad triggers"
            } or ${workflowHasConcurrency(workflow) ? "concurrency" : "missing concurrency"} are present.`,
            suggestion:
              "Review whether this job should be narrowed by branch, event, paths, or another condition.",
            measurementHint:
              "Check whether non-critical changes can skip this job after adding gating.",
            aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and add safe gating only if the job does not need to run for every event. This suggestion is prioritized because the repository looks large or CI-complex.`,
            score:
              78 -
              (workflowHasTriggerPathFilter(workflow) ? 12 : 0) -
              (workflowHasConcurrency(workflow) ? 8 : 0) -
              (workflowJobCount(workflow) > 6 ? 8 : 0),
          }),
        ),
      );
  },
};
