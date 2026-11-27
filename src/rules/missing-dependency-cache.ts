import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowJob, WorkflowStep } from "../workflow.ts";
import { isBlacksmithStickyDiskCacheStep } from "./shared/blacksmith-caches.ts";
import { type DependencyFamily, detectInstallCommand } from "./shared/tools.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import { isSubset, setDifference, setUnion } from "../set-algebra.ts";
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
  jobAllowsActionsCacheRestore,
  setupActionHasBuiltInCacheForFamily,
} from "./shared/workflow-caches.ts";
import { dependencyCacheJobIsReleaseLike } from "./shared/dependency-cache-release.ts";
import { collectCommandEntries, type CIDocument } from "./shared/any-step.ts";
import { detectInstallCommandFromText } from "./shared/tools-text.ts";
import { isMap } from "../yaml.ts";
import {
  collectCircleCiWorkflowInvocations,
  type CircleCiWorkflowInvocation,
} from "../circleci-workflow-graph.ts";
import { invocationCacheSteps } from "./shared/circleci-effective-steps.ts";

export const FAMILY_CACHE_MATCHERS: Record<DependencyFamily, string[]> = {
  npm: [".npm", "npm-cache"],
  pnpm: [".pnpm-store", "pnpm-store", "store/v3", "/pnpm/store"],
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
  job: WorkflowJob,
  families: Set<DependencyFamily>,
): Set<DependencyFamily> {
  const covered = new Set<DependencyFamily>();
  for (const [index, step] of job.steps.entries()) {
    const sticky = isBlacksmithStickyDiskCacheStep(job, step);
    if (!isManualCacheStep(step) && !sticky) {
      continue;
    }
    for (const family of families) {
      if (
        manualCacheMatchesFamily(step, family) &&
        (!sticky ||
          index < job.steps.findIndex((candidate) => detectInstallCommand(candidate) === family))
      ) {
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
  impliedChecks: ["setup-node-cache-dependency-path-unset"] as const,
  scope: "all",
} satisfies RuleMeta;

function circleCiCacheCovered(
  doc: Extract<CIDocument, { kind: "circleci" }>,
  jobName: string,
  invocations: readonly CircleCiWorkflowInvocation[],
): boolean {
  const job = doc.jobs.find((candidate) => candidate.name === jobName);
  if (!job) {
    return false;
  }
  const relevant = invocations.filter(
    (invocation) => invocation.jobName === jobName && !invocation.overrideWith,
  );
  if (relevant.length === 0 && invocations.some((inv) => inv.jobName === jobName)) {
    // Every invocation replaces the local job body with an opaque orb job.
    return true;
  }
  if (relevant.length === 0) {
    return job.steps.some((step) => step.type === "save_cache" || step.type === "restore_cache");
  }
  return relevant.every((invocation) =>
    (invocationCacheSteps(doc, job, invocation) ?? []).some(
      (step) => step.type === "save_cache" || step.type === "restore_cache",
    ),
  );
}

function gitlabCacheCovered(
  doc: Extract<CIDocument, { kind: "gitlab-ci" }>,
  jobName: string,
): boolean {
  const job = doc.jobs.find((candidate) => candidate.name === jobName);
  const defaultNode = doc.root?.get("default", true);
  return Boolean(
    job?.node.get("cache", true) !== undefined ||
    doc.root?.get("cache", true) !== undefined ||
    (isMap(defaultNode) && defaultNode.get("cache", true) !== undefined),
  );
}

function checkNonGitHubDependencies(doc: CIDocument, findings: Diagnostic[]): void {
  if (doc.kind === "buildkite" || doc.kind === "github-actions") {
    return;
  }
  const familiesByJob = new Map<string, Set<string>>();
  const firstNodeByJob = new Map<string, Parameters<typeof buildDiagnostic>[2]>();
  const circleCiInvocations =
    doc.kind === "circleci" ? collectCircleCiWorkflowInvocations(doc) : [];
  for (const entry of collectCommandEntries(doc)) {
    const family = detectInstallCommandFromText(entry.text);
    if (!family) {
      continue;
    }
    const families = familiesByJob.get(entry.jobName) ?? new Set<string>();
    families.add(family);
    familiesByJob.set(entry.jobName, families);
    if (!firstNodeByJob.has(entry.jobName)) {
      firstNodeByJob.set(entry.jobName, entry.node);
    }
  }

  for (const [jobName, families] of familiesByJob) {
    const covered =
      doc.kind === "circleci"
        ? circleCiCacheCovered(doc, jobName, circleCiInvocations)
        : gitlabCacheCovered(doc, jobName);
    if (covered) {
      continue;
    }
    findings.push(
      buildDiagnostic(doc, meta, firstNodeByJob.get(jobName), {
        message: `Job "${jobName}" installs dependencies (${[...families].join(", ")}) without a visible dependency cache.`,
        why: "Clean CI runners re-download and re-install dependencies on every run when the provider cache is not configured. The relative benefit depends on install duration and cache restore/save overhead.",
        suggestion:
          doc.kind === "circleci"
            ? "If this install path is expensive, add `save_cache`/`restore_cache` steps keyed on the lockfile and verify total job time improves."
            : "If this install path is expensive, configure GitLab CI `cache:` keyed on the lockfile and verify total job time improves.",
        measurementHint:
          "Compare total job duration, not just install duration, before and after enabling dependency caching.",
        aiHandoff: `Review ${doc.relativePath} job "${jobName}" and test whether the CI provider cache improves total job time before keeping it.`,
        score: 38,
      }),
    );
  }
}

export const missingDependencyCacheRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    if (doc.kind !== "github-actions") {
      checkNonGitHubDependencies(doc, findings);
      return findings;
    }
    const workflow = doc;

    for (const job of workflow.jobs) {
      if (
        !jobAllowsActionsCacheRestore(workflow, job) ||
        dependencyCacheJobIsReleaseLike(workflow, job)
      ) {
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

      const cachedByManual = computeManualCacheCoverage(job, installFamilies);

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

        const cached = setUnion<DependencyFamily>(cachedByBuiltIn, cachedByManual);
        if (isSubset(supportedFamilies, cached)) {
          continue;
        }
        const uncached = setDifference(supportedFamilies, cached);
        if (uncached.size === 0) {
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
              message: `${step.uses} is used without visible dependency caching for ${[...uncached].join(", ")} in job "${job.id}".`,
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

    return findings;
  },
};
