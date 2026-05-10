import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { type DependencyFamily, detectInstallCommand } from "./shared/tools.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import {
  withRepositoryDependencyCachePrecedent,
  withSimilarWorkflowDependencyCacheConsensus,
} from "./shared/similar-workflow-consensus.ts";
import {
  getSetupActionKind,
  getDependencyFamiliesUsedBySetupAction,
} from "./shared/workflow-setup-actions.ts";
import {
  isManualCacheStep,
  setupActionHasBuiltInCacheForFamily,
} from "./shared/workflow-caches.ts";
import { workflowLooksReleaseLike } from "./shared/workflow-jobs.ts";

const FAMILY_CACHE_MATCHERS: Record<DependencyFamily, string[]> = {
  npm: [".npm", "npm-cache"],
  pnpm: [".pnpm-store", "pnpm-store", "store/v3"],
  yarn: [".yarn/cache", ".yarn/install-state", "yarn-cache"],
  bun: [".bun", "bun/install/cache"],
  pip: [".cache/pip", "pip-cache"],
  pipenv: ["pipenv", "virtualenvs"],
  poetry: ["poetry", "virtualenvs"],
  uv: ["uv", ".cache/uv"],
  go: ["go/pkg/mod", ".cache/go-build"],
  maven: [".m2/repository"],
  gradle: [".gradle/caches", ".gradle/wrapper"],
  sbt: [".ivy2/cache", "coursier", ".sbt"],
  bundler: ["vendor/bundle", ".bundle", "rubygems", "gems"],
  nuget: [".nuget/packages"],
};

function getCachePathText(step: WorkflowStep): string {
  const pathValue = step.with?.path;
  return getStringList(pathValue).join("\n").toLowerCase();
}

function getStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function manualCacheMatchesFamily(step: WorkflowStep, family: DependencyFamily): boolean {
  const pathText = getCachePathText(step);
  if (pathText.length === 0) {
    return false;
  }
  return FAMILY_CACHE_MATCHERS[family].some((pattern) => pathText.includes(pattern));
}

function computeManualCacheCoverage(
  steps: WorkflowStep[],
  families: Set<DependencyFamily>,
): Set<DependencyFamily> {
  const covered = new Set<DependencyFamily>();
  for (const step of steps) {
    if (!isManualCacheStep(step)) {
      continue;
    }
    for (const family of families) {
      if (manualCacheMatchesFamily(step, family)) {
        covered.add(family);
      }
    }
  }
  return covered;
}

const meta = {
  id: "missing-dependency-cache",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-dependency-cache.md",
  impliedChecks: ["setup-node-cache-dependency-path-unset"],
} satisfies RuleMeta;

export const missingDependencyCacheRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (workflowLooksReleaseLike(workflow, job)) {
        continue;
      }

      const installFamilies = new Set<DependencyFamily>(
        job.steps
          .map((step) => detectInstallCommand(step))
          .filter((family): family is DependencyFamily => family !== undefined),
      );
      if (installFamilies.size === 0) {
        continue;
      }

      const cachedByManual = computeManualCacheCoverage(job.steps, installFamilies);

      for (const step of job.steps) {
        const action = getSetupActionKind(step);
        if (!action) {
          continue;
        }

        const supportedFamilies = getDependencyFamiliesUsedBySetupAction(action).filter((f) =>
          installFamilies.has(f),
        );
        if (supportedFamilies.length === 0) {
          continue;
        }

        const cachedByBuiltIn = supportedFamilies.filter((f) =>
          setupActionHasBuiltInCacheForFamily(step, f),
        );

        const cached = new Set<DependencyFamily>([...cachedByBuiltIn, ...cachedByManual]);
        const uncached = supportedFamilies.filter((f) => !cached.has(f));
        if (uncached.length === 0) {
          continue;
        }

        findings.push(
          pipe(
            withRepositoryDependencyCachePrecedent(_context, workflow.relativePath, job.id),
            withSimilarWorkflowDependencyCacheConsensus(_context, workflow.relativePath, job.id, {
              scoreBonus: 6,
              why: "That makes the missing cache look more like one repository-local drift point than a deliberate no-cache policy.",
              aiHandoff:
                "Start from the cache configuration already used by similar jobs in this repository, then verify that it improves total wall-clock time before keeping it.",
            }),
          )(
            buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
              message: `${step.uses} is used without visible dependency caching for ${uncached.join(", ")} in job "${job.id}".`,
              why: "Dependency install cost may be paid on every run, but cache restore and save overhead on GitHub Actions can outweigh the benefit on some CI paths.",
              suggestion:
                "If this install path is expensive enough to justify it, try the setup action cache or one explicit dependency cache strategy for this job and keep it only if total job time improves.",
              measurementHint:
                "Compare total job duration, not just install duration, before and after enabling cache.",
              aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and test whether dependency caching for ${step.uses} actually improves total job time on this CI path before keeping the change.`,
              score: 43,
            }),
          ),
        );
      }
    }

    return findings.slice(0, 3);
  },
};
