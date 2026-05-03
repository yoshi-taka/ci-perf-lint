import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowHasCachePath } from "./shared/workflow-caches.ts";
import { getWorkflowStepText } from "./shared/workflow-step-text.ts";

const meta = {
  id: "missing-angular-cli-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-angular-cli-cache.md",
} satisfies RuleMeta;

function jobRunsAngularTasks(job: WorkflowJob): boolean {
  return job.steps.some((step) =>
    /\bng\s+(?:build|test|serve|lint)\b/i.test(getWorkflowStepText(step)),
  );
}

const angularCachePathRe = /\.angular\/cache\b|\.cache\/ng\b/i;

export const missingAngularCliCacheRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (!context.repository.frameworks.usesAngularCli) {
      return [];
    }

    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs.filter((candidate) => jobRunsAngularTasks(candidate))) {
      if (!context.repository.frameworks.angularCliCacheEnabledForCi) {
        findings.push(
          buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
            message: `Job "${job.id}" runs Angular CLI tasks but the workspace does not visibly enable Angular CLI cache for CI.`,
            why: "Angular CLI cache defaults to local-only environments. No visible `cli.cache.environment` setting for `ci` or `all` was found in the Angular workspace config.",
            suggestion:
              "If this CI path repeats Angular CLI work, enable Angular CLI cache for `ci` or `all` in the workspace config and keep it only if total job time improves.",
            measurementHint:
              "Compare Angular task duration and total job time before and after enabling Angular CLI cache for CI.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" together with the Angular workspace config. If this CI path repeats Angular CLI work, test enabling Angular CLI cache for CI and keep it only when total time improves.`,
            score: 50,
          }),
        );
        continue;
      }

      if (!workflowHasCachePath(workflow, angularCachePathRe)) {
        findings.push(
          buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
            message: `Job "${job.id}" runs Angular CLI tasks without visible persistence for .angular/cache.`,
            why: "Angular CLI can use disk cache in CI, but no visible cache path for `.angular/cache` or `.cache/ng` is configured in this workflow.",
            suggestion:
              "If this CI path repeats Angular CLI work, persist the Angular cache directory in CI and keep it only if total job time improves.",
            measurementHint:
              "Compare cache restore time, Angular task duration, and cache save time before and after persisting the Angular cache directory.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and test whether persisting .angular/cache improves total CI time for repeated Angular CLI tasks on this path.`,
            score: 49,
          }),
        );
      }
    }

    return findings;
  },
};
