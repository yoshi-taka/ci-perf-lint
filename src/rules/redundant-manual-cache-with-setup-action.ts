import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import {
  getDependencyFamiliesUsedBySetupAction,
  getSetupActionKind,
} from "./shared/workflow-setup-actions.ts";
import {
  manualCacheStepMatchesDependencyFamily,
  setupActionHasBuiltInCacheForFamily,
} from "./shared/workflow-caches.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { withRepositorySingleCacheStrategyPrecedent } from "./shared/similar-workflow-consensus.ts";

const meta = {
  id: "redundant-manual-cache-with-setup-action",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/redundant-manual-cache-with-setup-action.md",
} satisfies RuleMeta;

export const redundantManualCacheWithSetupActionRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) =>
      job.steps.flatMap((step) => {
        const action = getSetupActionKind(step);
        if (!action) {
          return [];
        }

        const overlappingFamilies = getDependencyFamiliesUsedBySetupAction(action).filter(
          (family) =>
            setupActionHasBuiltInCacheForFamily(step, family) &&
            job.steps.some((candidate) =>
              manualCacheStepMatchesDependencyFamily(candidate, family),
            ),
        );
        if (overlappingFamilies.length === 0) {
          return [];
        }

        return [
          withRepositorySingleCacheStrategyPrecedent(
            buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
              message: `${step.uses} already handles ${overlappingFamilies.join(", ")} caching in job "${job.id}", but the job also defines a matching manual cache step.`,
              why: "Layering built-in cache and manual cache for the same dependency family can add maintenance cost and duplicate restore/save work.",
              suggestion:
                "Keep one cache strategy for the same dependency family unless the manual cache is covering something extra that the setup action does not.",
              measurementHint:
                "Compare restore/save time and cache hit behavior after removing the overlapping manual cache layer.",
              aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and remove overlapping manual cache steps when ${step.uses} already covers the same dependency family.`,
              score: 61,
            }),
            _context,
            workflow.relativePath,
            job.id,
          ),
        ];
      }),
    );
  },
};
