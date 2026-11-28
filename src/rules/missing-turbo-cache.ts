import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { isManualCacheStep, jobAllowsActionsCacheRestore } from "./shared/workflow-caches.ts";
import { toolInvocations } from "./shared/tool-command-evidence.ts";
import {
  repositoryCommandHead,
  shellFileRedirectionTargets,
} from "./shared/repository-command-evidence.ts";
import { effectiveStepEnvironment } from "./shared/workflow-env.ts";
import { declaredShellEnvironmentNames } from "./shared/shell-environment-evidence.ts";
import { shellExecutionTexts } from "./shared/shell-execution-text.ts";
import { shellCommandSegments } from "./shared/command-patterns.ts";
import { isBlacksmithStickyDiskCacheStep } from "./shared/blacksmith-caches.ts";
import { jobRunsOnBlacksmithRunner, jobRunsOnDepotRunner } from "./shared/runs-on-facts.ts";

const meta = {
  id: "missing-turbo-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-turbo-cache.md",
} satisfies RuleMeta;

function stepRunsTurboTasks(step: WorkflowStep): boolean {
  return toolInvocations(step.run ?? "").some((words) => {
    const [tool, action, task] = repositoryCommandHead(words);
    const separator = words.indexOf("--");
    const turboWords = separator < 0 ? words : words.slice(0, separator);
    return (
      tool === "turbo" &&
      action === "run" &&
      ["build", "test", "lint", "typecheck", "check"].includes(task ?? "") &&
      !turboWords.some((word) => /^--dry(?:-run)?(?:=|$)/.test(word))
    );
  });
}

function jobRunsTurboTasks(job: WorkflowJob): boolean {
  return job.steps.some(stepRunsTurboTasks);
}

function jobHasBlacksmithTurboCache(job: WorkflowJob): boolean {
  const firstTask = job.steps.findIndex(stepRunsTurboTasks);
  return job.steps.some(
    (step, index) =>
      isBlacksmithStickyDiskCacheStep(job, step) &&
      /\.turbo\b|node_modules\/\.cache\/turbo\b/i.test(turboCachePathText(step)) &&
      index < firstTask,
  );
}

function turboCachePathText(step: WorkflowStep): string {
  const pathValue = step.with?.path;
  return Array.isArray(pathValue)
    ? pathValue.filter((entry): entry is string => typeof entry === "string").join("\n")
    : typeof pathValue === "string"
      ? pathValue
      : "";
}

function isTurboCacheArtifactStep(step: WorkflowStep): boolean {
  const uses = step.uses?.toLowerCase() ?? "";
  if (
    !uses.startsWith("actions/upload-artifact@") &&
    !uses.startsWith("actions/download-artifact@")
  ) {
    return false;
  }
  const name = typeof step.with?.name === "string" ? step.with.name : "";
  return /\.turbo\b|node_modules\/\.cache\/turbo\b/i.test(`${turboCachePathText(step)}\n${name}`);
}

function workflowHasTurboLocalCache(workflow: WorkflowDocument): boolean {
  return workflow.jobs.some(
    (job) =>
      jobAllowsActionsCacheRestore(workflow, job) &&
      job.steps.some((step) => {
        if (isTurboCacheArtifactStep(step)) {
          return true;
        }
        if (!isManualCacheStep(step)) {
          return false;
        }
        return /\.turbo\b|node_modules\/\.cache\/turbo\b/i.test(turboCachePathText(step));
      }),
  );
}

function jobHasTurboRemoteCacheWiring(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  const names = ["TURBO_TOKEN", "TURBO_TEAM", "TURBO_API", "TURBO_REMOTE_ONLY"];
  const persisted = new Set<string>();
  const remoteActions: WorkflowStep[] = [];
  for (const step of job.steps) {
    const run = step.run ?? "";
    const environment = effectiveStepEnvironment(workflow, job, step);
    const declared = declaredShellEnvironmentNames(run);
    if (stepRunsTurboTasks(step)) {
      return (
        names.some((name) => name in environment || declared.has(name) || persisted.has(name)) ||
        remoteActions.some((action) => !action.ifNode || (!!action.if && action.if === step.if))
      );
    }
    if (/^rharkor\/caching-for-turbo@/i.test(step.uses ?? "")) {
      remoteActions.push(step);
    }
    for (const segment of shellExecutionTexts(run).flatMap(shellCommandSegments)) {
      if (
        shellFileRedirectionTargets(segment).some((target) =>
          ["$GITHUB_ENV", "${GITHUB_ENV}", '"$GITHUB_ENV"', '"${GITHUB_ENV}"'].includes(target),
        )
      ) {
        for (const name of declaredShellEnvironmentNames(segment)) {
          persisted.add(name);
        }
      }
    }
  }
  return false;
}

export const missingTurboCacheRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (
      !context.repository.frameworks.usesTurbo ||
      context.repository.frameworks.usesNx ||
      context.repository.frameworks.usesLerna ||
      workflowHasTurboLocalCache(workflow)
    ) {
      return [];
    }

    return workflow.jobs
      .filter(
        (job) =>
          jobAllowsActionsCacheRestore(workflow, job) &&
          jobRunsTurboTasks(job) &&
          !jobHasBlacksmithTurboCache(job) &&
          !jobHasTurboRemoteCacheWiring(workflow, job),
      )
      .map((job) => {
        const onDepot = jobRunsOnDepotRunner(job) && !job.raw.container;
        const automaticCachePossible =
          onDepot || (jobRunsOnBlacksmithRunner(job) && !job.raw.container);
        return buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs Turbo tasks without visible local or remote cache wiring.`,
          why: "Turbo is most effective in CI when task cache reuse is visible, but this workflow does not show a `.turbo` cache path or remote-cache environment wiring.",
          suggestion:
            "If this repository depends on repeated Turbo tasks in CI, add either local `.turbo` cache persistence or visible remote-cache wiring and keep it only if total job time improves.",
          measurementHint:
            "Compare cache restore time, Turbo task wall-clock time, cache hit rate, and cache save time before and after adding cache wiring.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" together with the repository's Turbo setup. If this CI path repeats the same Turbo tasks, test visible local or remote cache wiring and keep it only when total time improves.`,
          score: 52,
          ...(automaticCachePossible
            ? {
                severity: "suggestion" as const,
                ...(onDepot
                  ? {
                      message: `Job "${job.id}" runs Turbo on a Depot runner; Depot runners may configure Turbo remote cache automatically.`,
                      why: "Depot runners can provide Turborepo remote caching without YAML wiring, but an organization setting can disable it. The workflow cannot resolve that setting, actual cache hits or fork-PR restrictions.",
                      suggestion:
                        "Depot runners may configure Turbo remote cache automatically. Check the organization cache setting and the job log for remote cache hits before adding another cache. Preserve existing remote providers; verify outputs declarations before enabling task caching.",
                      aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Check Depot's organization cache setting and same-job logs for remote cache hits before adding local or remote cache wiring. Do not assume the cache is enabled, and do not remove another provider or cache external-state tasks blindly.`,
                    }
                  : {
                      message: `Job "${job.id}" runs Turbo on Blacksmith; cache coverage cannot be resolved from the visible workflow.`,
                      why: "Blacksmith can provide Turborepo remote caching without YAML wiring, and local composite actions may also configure caching. Dashboard settings, hidden setup and fork-PR restrictions are not resolved by this scanner.",
                      suggestion:
                        "Check Blacksmith's Turborepo cache setting and the job log for `Remote caching enabled` and cache hits before adding another cache. Preserve existing remote-cache providers; verify outputs declarations before enabling task caching.",
                      aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Verify Blacksmith's Turborepo cache setting and same-job logs before adding local or remote cache wiring. Do not assume the cache is enabled, and do not remove another provider or cache external-state tasks blindly.`,
                    }),
                score: 32,
              }
            : {}),
        });
      });
  },
};
