import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getLoweredWorkflowStepText } from "./shared/workflow-step-text.ts";
import { isManualCacheStep } from "./shared/workflow-caches.ts";

const meta = {
  id: "cache-terraform-providers",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/cache-terraform-providers.md",
} satisfies RuleMeta;

function getStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return [];
}

function getCachePathText(step: WorkflowStep): string {
  const pathValue = step.with?.path;
  return getStringList(pathValue).join("\n").toLowerCase();
}

function jobHasTerraformInit(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /\bterraform\s+init\b/.test(text);
  });
}

function jobHasTerraformProviderCache(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    if (isManualCacheStep(step)) {
      const pathText = getCachePathText(step);
      return /(\.terraform|plugin-cache)/.test(pathText);
    }

    return false;
  });
}

export const cacheTerraformProvidersRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      if (!jobHasTerraformInit(job)) {
        return [];
      }

      if (jobHasTerraformProviderCache(job)) {
        return [];
      }

      return [
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs terraform init without provider caching.`,
          why: "Terraform provider downloads can add 1-4 minutes per run, especially with large providers such as AWS (~150-180MB compressed). Caching eliminates repeated downloads when provider versions are stable.",
          suggestion: `Add an actions/cache step for ~/.terraform.d/plugin-cache (or .terraform/providers) keyed on a hash of .terraform.lock.hcl. Also ensure .terraform.lock.hcl is committed and includes CI platform hashes (linux_amd64, linux_arm64) via "terraform providers lock -platform=linux_amd64 -platform=linux_arm64".`,
          measurementHint:
            "Compare terraform init duration before and after caching. With a warm cache, init should drop from minutes to under 30 seconds.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Add a step before terraform init that sets TF_PLUGIN_CACHE_DIR and an actions/cache step for ~/.terraform.d/plugin-cache keyed on hashFiles('**/.terraform.lock.hcl'). Also ensure .terraform.lock.hcl has CI platform hashes by running "terraform providers lock -platform=linux_amd64 -platform=linux_arm64" and committing the result. Preserve existing terraform init and plan commands.`,
          score: 50,
        }),
      ];
    });
  },
};
