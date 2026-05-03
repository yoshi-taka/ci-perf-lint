import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { type DependencyFamily, detectInstallCommand } from "./shared/tools.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  withRepositoryDependencyCachePrecedent,
  withSimilarWorkflowDependencyCacheConsensus,
} from "./shared/similar-workflow-consensus.ts";
import { getSetupActionKind } from "./shared/workflow-setup-actions.ts";
import {
  manualCacheStepMatchesDependencyFamily,
  setupActionHasBuiltInCacheForFamily,
} from "./shared/workflow-caches.ts";

const meta = {
  id: "missing-dependency-cache",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-dependency-cache.md",
} satisfies RuleMeta;

export const missingDependencyCacheRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      const installFamilies = new Set<DependencyFamily>(
        job.steps
          .map((step) => detectInstallCommand(step))
          .filter((family): family is DependencyFamily => family !== undefined),
      );
      if (installFamilies.size === 0) {
        continue;
      }

      for (const step of job.steps) {
        const action = getSetupActionKind(step);
        if (!action) {
          continue;
        }

        const supportedInstallFamilies = [...installFamilies].filter((family) => {
          switch (action) {
            case "node":
              return family === "npm" || family === "pnpm" || family === "yarn";
            case "python":
              return family === "pip" || family === "pipenv" || family === "poetry";
            case "go":
              return family === "go";
            case "java":
              return family === "maven" || family === "gradle" || family === "sbt";
            case "ruby":
              return family === "bundler";
            case "dotnet":
              return family === "nuget";
          }
        });
        if (supportedInstallFamilies.length === 0) {
          continue;
        }

        const allFamiliesCached = supportedInstallFamilies.every(
          (family) =>
            setupActionHasBuiltInCacheForFamily(step, family) ||
            job.steps.some((candidate) =>
              manualCacheStepMatchesDependencyFamily(candidate, family),
            ),
        );
        if (allFamiliesCached) {
          continue;
        }

        findings.push(
          withSimilarWorkflowDependencyCacheConsensus(
            withRepositoryDependencyCachePrecedent(
              buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
                message: `${step.uses} is used without visible dependency caching in job "${job.id}".`,
                why: "Dependency install cost may be paid on every run, but cache restore and save overhead on GitHub Actions can outweigh the benefit on some CI paths.",
                suggestion:
                  "If this install path is expensive enough to justify it, try the setup action cache or one explicit dependency cache strategy for this job and keep it only if total job time improves.",
                measurementHint:
                  "Compare total job duration, not just install duration, before and after enabling cache.",
                aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and test whether dependency caching for ${step.uses} actually improves total job time on this CI path before keeping the change.`,
                score: 43,
              }),
              _context,
              workflow.relativePath,
              job.id,
            ),
            _context,
            workflow.relativePath,
            job.id,
            {
              scoreBonus: 6,
              why: "That makes the missing cache look more like one repository-local drift point than a deliberate no-cache policy.",
              aiHandoff:
                "Start from the cache configuration already used by similar jobs in this repository, then verify that it improves total wall-clock time before keeping it.",
            },
          ),
        );
      }
    }

    return findings;
  },
};
