import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { getNode } from "../workflow.ts";
import type { RuleContext } from "../rule-engine.ts";
import {
  hasDirectHeavySignals,
  isHeavyJob,
  workflowChangeSelectionProducerIds,
  workflowHasConcurrency,
  workflowJobCount,
} from "./shared/workflow-jobs.ts";
import { getTriggerFacts } from "./shared/trigger-facts.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import { withStackedDiffContext } from "./shared/stacked-diffs.ts";
import { selectSignal } from "./shared/signal-selector.ts";

const looksLargeOrComplex = selectSignal((s) => s.looksLargeOrComplex);

const meta = {
  id: "ungated-heavy-job",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/ungated-heavy-job.md",
} satisfies RuleMeta;

function condition(job: WorkflowJob): string {
  const value = job.raw.if;
  return typeof value === "string"
    ? value
        .trim()
        .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
        .replace(/\s+/g, "")
        .toLowerCase()
    : typeof value === "boolean"
      ? String(value)
      : value == null
        ? ""
        : "unknown";
}

/**
 * An `if: always()` job with dependencies whose steps read `needs.*`
 * results or outputs is a required-check reporter: it exists to summarize
 * upstream outcomes on every run, so it cannot be gated (agent-native's
 * fast-tests and build-gate are real examples). Heavy jobs that only use
 * always() to run real work keep reporting.
 */
function jobAggregatesUpstreamResults(job: WorkflowJob): boolean {
  if (condition(job) !== "always()") {
    return false;
  }
  const needs = job.raw.needs;
  const hasNeeds =
    typeof needs === "string" ? needs.trim().length > 0 : Array.isArray(needs) && needs.length > 0;
  if (!hasNeeds) {
    return false;
  }
  return job.steps.some((step) =>
    /needs\.[\w-]+\.|tojson\(\s*needs\s*\)/i.test(
      `${step.if ?? ""} ${stepEnvText(step)} ${step.run ?? ""}`,
    ),
  );
}

function stepEnvText(step: { readonly node: unknown }): string {
  const env = getNode(step.node as never, "env")?.toJSON();
  return env && typeof env === "object" ? JSON.stringify(env) : "";
}

function hasJobFilter(
  job: WorkflowJob,
  jobs: Map<string, WorkflowJob>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(job.id)) {
    return false;
  }
  seen.add(job.id);
  const expression = condition(job);
  if (expression && !["true", "success()", "always()"].includes(expression)) {
    return true;
  }
  // always() overrides the default dependency-success requirement.
  if (expression === "always()") {
    return false;
  }
  const needs = job.raw.needs;
  const dependencies = typeof needs === "string" ? [needs] : Array.isArray(needs) ? needs : [];
  return dependencies.some((id) => {
    const upstream = typeof id === "string" ? jobs.get(id) : undefined;
    return upstream ? hasJobFilter(upstream, jobs, seen) : false;
  });
}

export const ungatedHeavyJobRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (!looksLargeOrComplex.select(context.repository)) {
      return [];
    }

    const triggers = getTriggerFacts(workflow);
    if (!triggers.hasPullRequest && !triggers.hasPush) {
      return [];
    }
    // This rule asks only whether filtering exists, not whether it is optimal.
    // Component-specific filtering opportunities belong to the scoped-job rule.
    if (
      triggers.hasTriggerPathFilter ||
      triggers.push.hasBranches ||
      triggers.push.hasBranchesIgnore ||
      triggers.push.hasTags ||
      triggers.push.hasTagsIgnore ||
      triggers.pullRequest.hasBranches ||
      triggers.pullRequest.hasBranchesIgnore
    ) {
      return [];
    }

    const jobs = new Map(workflow.jobs.map((job) => [job.id, job]));
    const producers = workflowChangeSelectionProducerIds(workflow);
    return workflow.jobs
      .filter(
        (job) =>
          isHeavyJob(job) &&
          hasDirectHeavySignals(job) &&
          !producers.has(job.id) &&
          !jobAggregatesUpstreamResults(job) &&
          !hasJobFilter(job, jobs),
      )
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
            message: `Job "${job.id}" looks heavy, but no workflow branch/tag/path filter or job execution filter is visible.`,
            why: "Neither the workflow triggers nor this job's execution path narrow which branches or changes run the heavy work. Concurrency can stop stale runs, but does not select relevant changes.",
            suggestion:
              "Review whether this job should be narrowed by branch, event, paths, or another condition.",
            measurementHint:
              "Check whether non-critical changes can skip this job after adding gating.",
            aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and add safe gating only if the job does not need to run for every event. This suggestion is prioritized because the repository looks large or CI-complex.`,
            score:
              78 -
              (workflowHasConcurrency(workflow) ? 8 : 0) -
              (workflowJobCount(workflow) > 6 ? 8 : 0),
          }),
        ),
      );
  },
};
