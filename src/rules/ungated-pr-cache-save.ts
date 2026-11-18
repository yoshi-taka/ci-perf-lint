import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import {
  getScalarValue,
  type WorkflowDocument,
  type WorkflowJob,
  type WorkflowStep,
} from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getTriggerFacts } from "./shared/trigger-facts.ts";
import { jobAllowsActionsCacheSave } from "./shared/workflow-caches.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "ungated-pr-cache-save",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/ungated-pr-cache-save.md",
} satisfies RuleMeta;

// Keys pinned to a single commit (or run) can never be restored by another
// ref, which makes pull-request saves of them single-PR at best.
const commitPinnedKeyPattern =
  /github\.sha|github\.event\.pull_request\.head\.sha|github\.event\.merge_group\.head_sha|github\.run_id/;

// Conditions that keep a step or job from ever executing on pull_request runs.
const pullRequestExcludingPattern =
  /github\.event_name\s*(?:==\s*['"](?:push|workflow_dispatch|schedule)['"]|!=\s*['"]pull_request['"])|github\.ref\s*==\s*['"]refs\/heads\//;

function stepEnabledOnPullRequests(step: WorkflowStep): boolean {
  if (getScalarValue(step.node, "if") === false || step.if?.trim() === "false") {
    return false;
  }
  return step.if === undefined || !pullRequestExcludingPattern.test(step.if);
}

function jobEnabledOnPullRequests(job: WorkflowJob): boolean {
  const jobIf = job.raw.if;
  return (
    jobIf === undefined || typeof jobIf !== "string" || !pullRequestExcludingPattern.test(jobIf)
  );
}

function isCacheSaveStep(step: WorkflowStep): boolean {
  const uses = step.uses?.toLowerCase() ?? "";
  // actions/cache restores and saves; cache/restore never saves.
  return uses.startsWith("actions/cache@") || uses.startsWith("actions/cache/save@");
}

function commitPinnedKey(step: WorkflowStep): boolean {
  const key = step.with?.key;
  return typeof key === "string" && commitPinnedKeyPattern.test(key);
}

export const ungatedPrCacheSaveRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    const facts = getTriggerFacts(workflow);
    if (!facts.hasPullRequest) {
      return [];
    }

    // Without a long-lived branch ref (or a merge queue that re-runs entries),
    // a pull-request save only competes with itself for the quota.
    const hasBranchConsumer =
      (facts.hasPush && !facts.push.hasTagOnly) || facts.events.has("merge_group");
    if (!hasBranchConsumer) {
      return [];
    }
    // A merge queue ref is one-shot: a completely bare save step on such a
    // workflow writes entries nobody ever restores. Demand-gated saves
    // (step-level if: on outputs) may be skipped after a restore hit, so
    // only fully unguarded saves qualify.
    const mergeGroupOnlyWaste = facts.events.has("merge_group");

    for (const job of workflow.jobs) {
      if (
        jobIsStaticallyDisabled(job) ||
        !jobEnabledOnPullRequests(job) ||
        !jobAllowsActionsCacheSave(workflow, job)
      ) {
        continue;
      }

      const offenders = job.steps.filter(
        (step) =>
          isCacheSaveStep(step) &&
          stepEnabledOnPullRequests(step) &&
          (commitPinnedKey(step) || (mergeGroupOnlyWaste && step.if === undefined)),
      );
      if (offenders.length === 0) {
        continue;
      }

      const anchor = offenders[0]!;
      findings.push(
        buildDiagnostic(workflow, meta, anchor.withNode ?? anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" saves Actions caches from ${mergeGroupOnlyWaste ? "pull_request and merge-queue runs" : "pull_request runs"} without a non-PR guard (${offenders
            .map((step) => step.uses)
            .join(", ")}).`,
          why: "A cache written during a pull request run is only readable by that same pull request, so every other run — including branch pushes — restores nothing from it, while the write still consumes upload time and the shared cache quota that branch-scoped entries need. Merge-queue refs are one-shot, so saves from those runs are never read at all.",
          suggestion:
            "Keep actions/cache/restore on every run and move the write to actions/cache/save guarded to branch pushes (for example `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`). Keep an unguarded pull-request save only when same-PR iteration reuse measurably outweighs the upload and quota cost.",
          measurementHint:
            "Compare cache upload time per pull request run, eviction of branch-scoped entries, and warm restore hits on push runs before and after gating the save.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Split the cache step into restore plus a push-gated save, or justify the pull-request save by same-PR reuse. Do not change cache paths or keys while gating the save.`,
          score: 55,
        }),
      );
    }

    return findings;
  },
};
