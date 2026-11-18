import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getTriggerFacts } from "./shared/trigger-facts.ts";
import {
  excludesPullRequestRuns,
  jobEnabledOnPullRequests,
  stepEnabledOnPullRequests,
} from "./shared/pr-run-scope.ts";
import { jobAllowsActionsCacheSave } from "./shared/workflow-caches.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "ungated-pr-docker-gha-export",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/ungated-pr-docker-gha-export.md",
} satisfies RuleMeta;

function stepUsesDockerBuildPush(step: WorkflowStep): boolean {
  return step.uses?.toLowerCase().startsWith("docker/build-push-action@") === true;
}

function cacheToText(step: WorkflowStep): string {
  const cacheTo = step.with?.["cache-to"];
  return typeof cacheTo === "string" ? cacheTo : "";
}

/** GHA backend with a reachable mode=max arm (literal or expression). */
function exportsMaxLayersToGha(step: WorkflowStep): boolean {
  const text = cacheToText(step);
  return (
    text.includes("type=gha") &&
    /\bmax\b/.test(text) &&
    // A push-only expression (anthropics/buffa shape) never exports on PRs.
    !excludesPullRequestRuns(text)
  );
}

export const ungatedPrDockerGhaExportRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    const facts = getTriggerFacts(workflow);
    if (!facts.hasPullRequest || !(facts.hasPush && !facts.push.hasTagOnly)) {
      return [];
    }

    for (const job of workflow.jobs) {
      if (
        job.usesReusableWorkflow ||
        jobIsStaticallyDisabled(job) ||
        !jobEnabledOnPullRequests(job) ||
        !jobAllowsActionsCacheSave(workflow, job)
      ) {
        continue;
      }

      const offenders = job.steps.filter(
        (step) =>
          stepUsesDockerBuildPush(step) &&
          stepEnabledOnPullRequests(step) &&
          exportsMaxLayersToGha(step),
      );
      if (offenders.length === 0) {
        continue;
      }

      const anchor = offenders[0]!;
      findings.push(
        buildDiagnostic(workflow, meta, anchor.withNode ?? anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" exports mode=max GitHub Actions cache layers from pull_request runs without a non-PR guard (${offenders
            .map((step) => step.name ?? step.uses)
            .join(", ")}).`,
          why: "A GHA cache entry written on a pull request is readable only by that same pull request, and mode=max uploads every intermediate stage: the write costs export time and the shared cache quota that branch builds rely on, while the only possible reader is a later run of the same PR. Branch builds get the deepest layer reuse from mode=max; pull-request runs often serve themselves better with mode=min or no export at all. Large images in PR-heavy flows have measured full exports evicting each other before reuse, at minutes of cost per build.",
          suggestion:
            "Prefer `mode=min` for pull-request builds, or skip the export on PR runs and keep mode=max for branch builds (for example `cache-to: ${{ github.event_name == 'push' && 'type=gha,mode=max' || '' }}`). Keep the unguarded PR export only when same-PR layer reuse measurably outweighs the export and quota cost.",
          measurementHint:
            "Compare export upload time per pull-request build, eviction of branch-scoped layer entries, and warm layer reuse on PR and branch runs before and after scoping the export.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Scope the GHA cache export to branch builds or switch pull-request builds to mode=min. Preserve cache-from and provenance settings while changing the export policy.`,
          score: 35,
        }),
      );
    }

    return findings;
  },
};
