import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { stepDisablesDockerBuildCache } from "./shared/docker.ts";
import {
  jobAllowsActionsCacheRestore,
  jobAllowsActionsCacheSave,
} from "./shared/workflow-caches.ts";

const meta = {
  id: "docker-build-without-layer-cache",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/docker-build-without-layer-cache.md",
  precheck: (workflow) =>
    workflow.source?.includes("docker/build-push-action") || workflow.source?.includes("--push")
      ? 1
      : 0,
} satisfies RuleMeta;

function stepUsesDockerBuildPushAction(step: WorkflowStep): boolean {
  const uses = step.uses?.toLowerCase() ?? "";
  return uses.startsWith("docker/build-push-action@");
}

function stepHasCacheFrom(step: WorkflowStep): boolean {
  const cacheFrom = step.with?.["cache-from"];
  return typeof cacheFrom === "string" && cacheFrom.trim() !== "";
}

function stepHasLayerCache(step: WorkflowStep): boolean {
  const cacheFrom = step.with?.["cache-from"];
  const cacheTo = step.with?.["cache-to"];
  if (
    typeof cacheFrom === "string" &&
    cacheFrom.trim() !== "" &&
    typeof cacheTo === "string" &&
    cacheTo.trim() !== ""
  ) {
    return true;
  }
  return false;
}

export const dockerBuildWithoutLayerCacheRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || !jobAllowsActionsCacheRestore(workflow, job)) {
        continue;
      }

      const step = job.steps.find(
        (candidate) =>
          stepUsesDockerBuildPushAction(candidate) &&
          !stepDisablesDockerBuildCache(candidate) &&
          !stepHasLayerCache(candidate) &&
          // A read-only GHA backend can reuse layers without exporting them.
          (jobAllowsActionsCacheSave(workflow, job) ||
            typeof candidate.with?.["cache-from"] !== "string" ||
            !/(?:^|[,\n])\s*type=gha(?:[,\n]|$)/.test(candidate.with["cache-from"])),
      );
      if (!step) {
        continue;
      }

      const message = stepHasCacheFrom(step)
        ? `Job "${job.id}" uses docker/build-push-action with cache-from but without cache-to; new layers may not be exported for future runs.`
        : `Job "${job.id}" uses docker/build-push-action without cache-from and cache-to configuration.`;
      findings.push(
        buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
          message,
          why: "Without layer caching, every CI run rebuilds all Docker layers from scratch, adding minutes per build. docker/build-push-action supports cache-from and cache-to natively; the simplest setup uses the GitHub Actions cache backend.",
          suggestion:
            "Add cache-from and cache-to to the docker/build-push-action step. For example: `cache-from: type=gha` and `cache-to: type=gha,mode=max`. If this build also runs on pull requests, note GHA cache entries written there are readable only within that same PR and mode=max exports every stage: prefer `mode=min` on PR runs or keep the export for branch builds only, and keep mode=max for branch builds.",
          measurementHint:
            "Compare Docker build wall-clock time before and after adding layer caching, including any export upload time on PR runs and eviction of branch-scoped entries. A multi-minute reduction is common for images with several layers.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and add \`cache-from: type=gha\` and \`cache-to: type=gha,mode=max\` to the docker/build-push-action step unless \`no-cache: true\` is intentional. If the job also runs on pull requests, scope the export to branch builds or use mode=min there.`,
          score: 78,
        }),
      );
    }
    return findings;
  },
};
