import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { hasDependencyCacheConfig } from "./shared/workflow-caches.ts";
import { isOutdatedSetupAction } from "./shared/workflow-setup-actions.ts";
import { withRepositorySetupCachePrecedent } from "./shared/similar-workflow-consensus.ts";

const meta = {
  id: "outdated-setup-action-without-cache",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/outdated-setup-action-without-cache.md",
} satisfies RuleMeta;

export const outdatedSetupActionWithoutCacheRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (!step.uses || !isOutdatedSetupAction(step.uses) || hasDependencyCacheConfig(step)) {
          continue;
        }

        findings.push(
          withRepositorySetupCachePrecedent(
            buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
              message: `${step.uses} is old and no cache configuration is visible.`,
              why: "The performance win is not the version bump by itself; it is using a current setup action to enable the package-manager cache close to the language setup step. Without visible cache configuration, dependency downloads and installs are more likely to be paid again on each run.",
              suggestion:
                "Upgrade to a current setup action major and enable its built-in cache for the package manager or language dependency path used by this job.",
              measurementHint:
                "Re-run the workflow after updating setup and compare setup, cache restore, and dependency install duration.",
              aiHandoff: `Review ${workflow.relativePath} and upgrade ${step.uses} to a current major version together with cache enablement.`,
              score: 85,
            }),
            context,
            workflow.relativePath,
            job.id,
          ),
        );
      }
    }

    return findings;
  },
};
