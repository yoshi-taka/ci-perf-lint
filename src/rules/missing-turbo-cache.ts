import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { isManualCacheStep } from "./shared/workflow-caches.ts";

const meta = {
  id: "missing-turbo-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-turbo-cache.md",
} satisfies RuleMeta;

function stepText(step: WorkflowStep): string {
  return `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""}`;
}

function jobRunsTurboTasks(job: WorkflowJob): boolean {
  return job.steps.some((step) =>
    /\bturbo\s+run\s+(?:build|test|lint|typecheck|check)\b/i.test(stepText(step)),
  );
}

function workflowHasTurboLocalCache(workflow: WorkflowDocument): boolean {
  return workflow.jobs.some((job) =>
    job.steps.some((step) => {
      if (!isManualCacheStep(step)) {
        return false;
      }

      const pathValue = step.with?.path;
      const pathText = Array.isArray(pathValue)
        ? pathValue.filter((entry): entry is string => typeof entry === "string").join("\n")
        : typeof pathValue === "string"
          ? pathValue
          : "";

      return /\.turbo\b|node_modules\/\.cache\/turbo\b/i.test(pathText);
    }),
  );
}

function workflowHasTurboRemoteCacheWiring(workflow: WorkflowDocument): boolean {
  return /\bTURBO_TOKEN\b|\bTURBO_TEAM\b|\bTURBO_API\b|\bTURBO_REMOTE_ONLY\b/i.test(
    workflow.source!,
  );
}

export const missingTurboCacheRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (
      !context.repository.frameworks.usesTurbo ||
      context.repository.frameworks.usesNx ||
      context.repository.frameworks.usesLerna ||
      workflowHasTurboLocalCache(workflow) ||
      workflowHasTurboRemoteCacheWiring(workflow)
    ) {
      return [];
    }

    return workflow.jobs
      .filter((job) => jobRunsTurboTasks(job))
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs Turbo tasks without visible local or remote cache wiring.`,
          why: "Turbo is most effective in CI when task cache reuse is visible, but this workflow does not show a `.turbo` cache path or remote-cache environment wiring.",
          suggestion:
            "If this repository depends on repeated Turbo tasks in CI, add either local `.turbo` cache persistence or visible remote-cache wiring and keep it only if total job time improves.",
          measurementHint:
            "Compare cache restore time, Turbo task wall-clock time, cache hit rate, and cache save time before and after adding cache wiring.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" together with the repository's Turbo setup. If this CI path repeats the same Turbo tasks, test visible local or remote cache wiring and keep it only when total time improves.`,
          score: 52,
        }),
      );
  },
};
