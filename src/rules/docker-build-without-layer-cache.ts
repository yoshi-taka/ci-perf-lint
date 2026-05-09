import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { stepDisablesDockerBuildCache } from "./shared/docker.ts";

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

function stepUsesDockerOrDepotBuildPushAction(step: WorkflowStep): boolean {
  const uses = step.uses?.toLowerCase() ?? "";
  return (
    uses.startsWith("docker/build-push-action@") || uses.startsWith("depot/build-push-action@")
  );
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
      if (job.usesReusableWorkflow) {
        continue;
      }

      const step = job.steps.find(
        (candidate) =>
          stepUsesDockerOrDepotBuildPushAction(candidate) &&
          !stepDisablesDockerBuildCache(candidate) &&
          !stepHasLayerCache(candidate),
      );
      if (!step) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
          message: `Job "${job.id}" uses docker/build-push-action without cache-from and cache-to configuration.`,
          why: "Without layer caching, every CI run rebuilds all Docker layers from scratch, adding minutes per build. docker/build-push-action supports cache-from and cache-to natively; the simplest setup uses the GitHub Actions cache backend.",
          suggestion:
            "Add cache-from and cache-to to the docker/build-push-action step. For example: `cache-from: type=gha` and `cache-to: type=gha,mode=max`.",
          measurementHint:
            "Compare Docker build wall-clock time before and after adding layer caching. A multi-minute reduction is common for images with several layers.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and add \`cache-from: type=gha\` and \`cache-to: type=gha,mode=max\` to the docker/build-push-action step unless \`no-cache: true\` is intentional.`,
          score: 78,
        }),
      );
    }
    return findings;
  },
};
