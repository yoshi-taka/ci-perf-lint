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

const meta = {
  id: "missing-turbo-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-turbo-cache.md",
} satisfies RuleMeta;

function stepRunsTurboTasks(step: WorkflowStep): boolean {
  return toolInvocations(step.run ?? "").some((words) => {
    const [tool, action, task] = repositoryCommandHead(words);
    return (
      tool === "turbo" &&
      action === "run" &&
      ["build", "test", "lint", "typecheck", "check"].includes(task ?? "")
    );
  });
}

function jobRunsTurboTasks(job: WorkflowJob): boolean {
  return job.steps.some(stepRunsTurboTasks);
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
  for (const step of job.steps) {
    const run = step.run ?? "";
    const environment = effectiveStepEnvironment(workflow, job, step);
    const declared = declaredShellEnvironmentNames(run);
    if (
      stepRunsTurboTasks(step) &&
      names.some((name) => name in environment || declared.has(name) || persisted.has(name))
    ) {
      return true;
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
          !jobHasTurboRemoteCacheWiring(workflow, job),
      )
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
