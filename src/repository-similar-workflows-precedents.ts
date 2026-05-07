import type { WorkflowDocument, WorkflowJob } from "./workflow.ts";
import type { YAMLMap } from "yaml";
import { getScalarValue, getStringOrArrayValue } from "./workflow.ts";
import { collectScopePrefixes } from "./rules/shared/workflow-path-prefixes.ts";
import {
  hasHistoryDependentCommand,
  isHeavyWorkflow,
  isHeavyJob,
  jobIsStaticallyDisabled,
  hasOpaqueRepoScriptExecution,
  workflowHasConcurrency,
  workflowLooksReleaseLike,
} from "./rules/shared/workflow-jobs.ts";
import { getCheckoutStep } from "./rules/shared/workflow-analysis.ts";
import { getLoweredWorkflowStepText } from "./rules/shared/workflow-step-text.ts";
import {
  getWorkflowScheduleCrons,
  workflowHasManualOnlyTrigger,
  workflowHasNonCodeIgnore,
  workflowHasScheduleTrigger,
  workflowHasTriggerPathFilter,
} from "./rules/shared/workflow-triggers.ts";
import { estimateScheduleMinutes } from "./rules/scheduled-heavy-workflow-without-throttling.ts";
import type { JobSummary } from "./repository-similar-workflows-job-summaries.ts";

export interface RepositoryPrecedentSignals {
  concurrency: {
    workflowPath: string;
  }[];
  timeoutMinutes: {
    workflowPath: string;
    jobId: string;
  }[];
  dependencyCache: {
    workflowPath: string;
    jobId: string;
  }[];
  shallowCheckout: {
    workflowPath: string;
    jobId: string;
  }[];
  pathsFilter: {
    workflowPath: string;
  }[];
  nonCodeIgnore: {
    workflowPath: string;
  }[];
  setupCache: {
    workflowPath: string;
    jobId: string;
  }[];
  releaseDownstreamSuccessGuard: {
    workflowPath: string;
    jobId: string;
  }[];
  blobNoneReleaseMetadata: {
    workflowPath: string;
    jobId: string;
  }[];
  sparseCheckoutScoped: {
    workflowPath: string;
    jobId: string;
  }[];
  throttledHeavySchedule: {
    workflowPath: string;
  }[];
}

function isYamlMap(node: unknown): node is YAMLMap<unknown, unknown> {
  return Boolean(node && typeof node === "object" && "items" in (node as Record<string, unknown>));
}

function getJobIfText(job: WorkflowJob): string {
  if (isYamlMap(job.node)) {
    const value = getScalarValue(job.node, "if");
    return typeof value === "string" ? value : "";
  }
  return typeof job.raw.if === "string" ? job.raw.if : "";
}

function jobHasNeeds(job: WorkflowJob): boolean {
  if (isYamlMap(job.node)) {
    const needs = getStringOrArrayValue(job.node, "needs");
    return (
      (typeof needs === "string" && needs.trim().length > 0) ||
      (Array.isArray(needs) &&
        needs.some((entry) => typeof entry === "string" && entry.trim().length > 0))
    );
  }
  const needs = job.raw.needs;
  return (
    (typeof needs === "string" && needs.trim().length > 0) ||
    (Array.isArray(needs) &&
      needs.some((entry) => typeof entry === "string" && entry.trim().length > 0))
  );
}

function hasNeedsSuccessGuard(ifText: string): boolean {
  return /needs\.[^.]+\.result\s*==\s*['"]success['"]/.test(ifText);
}

function hasFailureCancelledGuard(ifText: string): boolean {
  return /!failure\(\)\s*&&\s*!cancelled\(\)|!cancelled\(\)\s*&&\s*!failure\(\)/.test(ifText);
}

function hasStatusFunction(ifText: string): boolean {
  return (
    /\b(?:always|failure|cancelled|success)\(\)/.test(ifText) || ifText.includes("!cancelled()")
  );
}

function hasOptionalSkipBypass(ifText: string): boolean {
  return (
    /github\.event_name\s*(?:==|!=)\s*['"][^'"]+['"]/.test(ifText) ||
    /needs\.[^.]+\.outputs\.[A-Za-z0-9_-]+/.test(ifText) ||
    /needs\.[^.]+\.result\s*==\s*['"]skipped['"]/.test(ifText)
  );
}

function getCheckoutInput(
  step: WorkflowJob["steps"][number] | undefined,
  key: string,
): string | undefined {
  const value = step?.with?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasSparseCheckout(step: WorkflowJob["steps"][number] | undefined): boolean {
  return Boolean(getCheckoutInput(step, "sparse-checkout"));
}

function hasBlobNoneFilter(step: WorkflowJob["steps"][number] | undefined): boolean {
  return getCheckoutInput(step, "filter") === "blob:none";
}

function hasDeepHistory(step: WorkflowJob["steps"][number] | undefined): boolean {
  const value = step?.with?.["fetch-depth"];
  if (value === 0 || value === "0") {
    return true;
  }
  if (typeof value === "number" && value > 1000) {
    return true;
  }
  if (typeof value === "string" && /^\d{4,}$/.test(value) && Number(value) > 1000) {
    return true;
  }
  return false;
}

function jobHasWideRepoAccess(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /(find\s+\.\b|rg\s+(?:--files\b|\.)|fd\s+\.\b|git\s+grep\b|ls\s+-r\b|du\s+-|turbo\s+run\b|nx\s+affected\b|lerna\b)/.test(
      text,
    );
  });
}

function jobHasHeavyBuildOrInstall(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /(\bnpm\s+(?:ci|install|run\s+build)\b|\bpnpm\s+(?:install|build)\b|\byarn\s+(?:install|build)\b|\bbun\s+(?:install|run\s+build)\b|\bpytest\b|\bjest\b|\bvitest\b|\bcargo\s+build\b|\bgradle\b|\bmvn\b|tauri|electron-builder|docker build)/.test(
      text,
    );
  });
}

function jobLooksLikeBlobHungryReleasePipeline(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text =
      `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""} ${JSON.stringify(step.with ?? {})}`.toLowerCase();
    if (
      /(install-code-deps["']?\s*:\s*(?:["']?true|true)|\brelease:publish\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile|pack|publish)\b|\byarn\s+task\b[\s\S]*\bcompile\b)/.test(
        text,
      )
    ) {
      return true;
    }

    return (
      /\bgit\s+(?:checkout|pull|merge)\b/.test(text) && /\b(?:publish|compile|build)\b/.test(text)
    );
  });
}

function jobLooksLikeRepoEditingAgenticDocsJob(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text =
      `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""} ${JSON.stringify(step.with ?? {})}`.toLowerCase();
    return (
      /(sst\/opencode\/github@|claude|codex|openai|anthropic|gemini|ai agent|agentic|autofix|code review)/.test(
        text,
      ) &&
      /(content\/docs|docs\/|documentation|update docs|write docs|edit docs|changed files|modified files)/.test(
        text,
      )
    );
  });
}

function jobHasExplicitFilteredFetchCandidate(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /\bgit\s+fetch\b(?=[\s\S]*--depth[=\s]\d+)/.test(text) && !text.includes("--filter=");
  });
}

function jobLooksHistoryMetadataLike(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  const workflowName = workflow.name?.toLowerCase() ?? "";
  const jobId = job.id.toLowerCase();

  if (/\b(release notes|changelog|tag|version|release|commitlint)\b/.test(workflowName)) {
    return true;
  }

  if (/\b(release-notes|release_notes|changelog|tag|version|release|commitlint)\b/.test(jobId)) {
    return true;
  }

  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /(\bgh\s+release\s+(?:create|view|edit|upload)\b|\bgh\s+api\b.*\/releases\b|\bgit\s+(?:describe|tag|rev-list|log)\b|commitlint|commitlint-github-action|release notes|changelog|previous tag|semantic-release|release-it|changeset|git-cliff|conventional-changelog|changelogithub|release-please|googleapis\/release-please-action@|release-please-automation-action@|softprops\/action-gh-release@|ncipollo\/release-action@|release-drafter\/release-drafter@|actions\/create-release@)/.test(
      text,
    );
  });
}

function jobHasStrongReleaseMetadataSignal(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return /(\bgh\s+release\s+(?:create|view|edit|upload)\b|\bgh\s+api\b.*\/releases\b|release notes|changelog|git-cliff|conventional-changelog|changelogithub|release-please|googleapis\/release-please-action@|release-please-automation-action@|softprops\/action-gh-release@|ncipollo\/release-action@|release-drafter\/release-drafter@|actions\/create-release@)/.test(
      text,
    );
  });
}

function jobLooksCommitMetadataLike(job: WorkflowJob): boolean {
  const jobId = job.id.toLowerCase();
  if (/\bcommitlint\b/.test(jobId)) {
    return true;
  }

  return job.steps.some((step) =>
    /(commitlint|commitlint-github-action)/.test(getLoweredWorkflowStepText(step)),
  );
}

export function collectRepositoryPrecedentSignals(
  workflows: WorkflowDocument[],
  sharedJobSummaries: JobSummary[],
): RepositoryPrecedentSignals {
  return {
    concurrency: workflows
      .filter((workflow) => workflowHasConcurrency(workflow))
      .map((workflow) => ({ workflowPath: workflow.relativePath }))
      .sort((left, right) => left.workflowPath.localeCompare(right.workflowPath))
      .slice(0, 10),
    timeoutMinutes: sharedJobSummaries
      .filter((summary) => summary.isTimeoutCandidate && summary.hasTimeout)
      .map((summary) => ({
        workflowPath: summary.workflow.relativePath,
        jobId: summary.job.id,
      }))
      .sort(
        (left, right) =>
          left.workflowPath.localeCompare(right.workflowPath) ||
          left.jobId.localeCompare(right.jobId),
      )
      .slice(0, 10),
    dependencyCache: sharedJobSummaries
      .filter((summary) => summary.isCacheCandidate && summary.hasDependencyCache)
      .map((summary) => ({
        workflowPath: summary.workflow.relativePath,
        jobId: summary.job.id,
      }))
      .sort(
        (left, right) =>
          left.workflowPath.localeCompare(right.workflowPath) ||
          left.jobId.localeCompare(right.jobId),
      )
      .slice(0, 10),
    shallowCheckout: sharedJobSummaries
      .filter((summary) => summary.isDeepCheckoutCandidate && !summary.usesDeepCheckout)
      .map((summary) => ({
        workflowPath: summary.workflow.relativePath,
        jobId: summary.job.id,
      }))
      .sort(
        (left, right) =>
          left.workflowPath.localeCompare(right.workflowPath) ||
          left.jobId.localeCompare(right.jobId),
      )
      .slice(0, 10),
    pathsFilter: workflows
      .filter((workflow) => workflowHasTriggerPathFilter(workflow))
      .map((workflow) => ({ workflowPath: workflow.relativePath }))
      .sort((left, right) => left.workflowPath.localeCompare(right.workflowPath))
      .slice(0, 10),
    nonCodeIgnore: workflows
      .filter((workflow) => workflowHasNonCodeIgnore(workflow))
      .map((workflow) => ({ workflowPath: workflow.relativePath }))
      .sort((left, right) => left.workflowPath.localeCompare(right.workflowPath))
      .slice(0, 10),
    setupCache: sharedJobSummaries
      .filter((summary) => summary.isCacheCandidate && summary.hasDependencyCache)
      .map((summary) => ({
        workflowPath: summary.workflow.relativePath,
        jobId: summary.job.id,
      }))
      .sort(
        (left, right) =>
          left.workflowPath.localeCompare(right.workflowPath) ||
          left.jobId.localeCompare(right.jobId),
      )
      .slice(0, 10),
    releaseDownstreamSuccessGuard: workflows
      .flatMap((workflow) =>
        workflow.jobs
          .filter((job) => {
            const ifText = getJobIfText(job);
            return (
              workflowLooksReleaseLike(workflow, job) &&
              jobHasNeeds(job) &&
              hasStatusFunction(ifText) &&
              !hasOptionalSkipBypass(ifText) &&
              hasNeedsSuccessGuard(ifText) &&
              hasFailureCancelledGuard(ifText)
            );
          })
          .map((job) => ({
            workflowPath: workflow.relativePath,
            jobId: job.id,
          })),
      )
      .sort(
        (left, right) =>
          left.workflowPath.localeCompare(right.workflowPath) ||
          left.jobId.localeCompare(right.jobId),
      )
      .slice(0, 10),
    blobNoneReleaseMetadata: workflows
      .flatMap((workflow) =>
        workflow.jobs
          .filter((job) => {
            const checkout = getCheckoutStep(job);
            if (
              !jobLooksHistoryMetadataLike(workflow, job) ||
              !checkout ||
              !hasBlobNoneFilter(checkout)
            ) {
              return false;
            }

            if (!hasDeepHistory(checkout) && !hasHistoryDependentCommand(job)) {
              return false;
            }

            if (
              jobHasWideRepoAccess(job) ||
              jobHasHeavyBuildOrInstall(job) ||
              jobLooksLikeBlobHungryReleasePipeline(job) ||
              jobLooksLikeRepoEditingAgenticDocsJob(job)
            ) {
              return false;
            }

            const scopePrefixes = collectScopePrefixes(job);
            const hasExplicitFilteredFetch = jobHasExplicitFilteredFetchCandidate(job);
            if (
              !jobLooksCommitMetadataLike(job) &&
              !jobHasStrongReleaseMetadataSignal(job) &&
              !hasExplicitFilteredFetch &&
              !hasSparseCheckout(checkout) &&
              (scopePrefixes.length === 0 || scopePrefixes.length > 3)
            ) {
              return false;
            }

            return true;
          })
          .map((job) => ({
            workflowPath: workflow.relativePath,
            jobId: job.id,
          })),
      )
      .sort(
        (left, right) =>
          left.workflowPath.localeCompare(right.workflowPath) ||
          left.jobId.localeCompare(right.jobId),
      )
      .slice(0, 10),
    sparseCheckoutScoped: workflows
      .flatMap((workflow) =>
        workflow.jobs
          .filter((job) => {
            if (!workflowLooksReleaseLike(workflow, job) && !isHeavyJob(job)) {
              return false;
            }

            if (jobIsStaticallyDisabled(job)) {
              return false;
            }

            const checkout = getCheckoutStep(job);
            if (!checkout || !hasSparseCheckout(checkout)) {
              return false;
            }

            const scopePrefixes = collectScopePrefixes(job);
            if (scopePrefixes.length === 0 || scopePrefixes.length > 3) {
              return false;
            }

            if (jobHasWideRepoAccess(job) || jobHasHeavyBuildOrInstall(job)) {
              return false;
            }

            if (
              scopePrefixes.every((prefix) => /^(?:script|scripts)\b/.test(prefix)) ||
              hasOpaqueRepoScriptExecution(job) ||
              jobLooksLikeRepoEditingAgenticDocsJob(job)
            ) {
              return false;
            }

            return hasDeepHistory(checkout) || hasHistoryDependentCommand(job);
          })
          .map((job) => ({
            workflowPath: workflow.relativePath,
            jobId: job.id,
          })),
      )
      .sort(
        (left, right) =>
          left.workflowPath.localeCompare(right.workflowPath) ||
          left.jobId.localeCompare(right.jobId),
      )
      .slice(0, 10),
    throttledHeavySchedule: workflows
      .filter((workflow) => {
        if (
          workflowHasManualOnlyTrigger(workflow) ||
          !workflowHasScheduleTrigger(workflow) ||
          !isHeavyWorkflow(workflow)
        ) {
          return false;
        }

        const minimumInterval = getWorkflowScheduleCrons(workflow)
          .map((cron) => estimateScheduleMinutes(cron))
          .filter((value): value is number => value !== undefined)
          .sort((left, right) => left - right)[0];

        return minimumInterval !== undefined && minimumInterval >= 180;
      })
      .map((workflow) => ({ workflowPath: workflow.relativePath }))
      .sort((left, right) => left.workflowPath.localeCompare(right.workflowPath))
      .slice(0, 10),
  };
}
