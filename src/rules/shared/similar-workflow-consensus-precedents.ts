import type { Diagnostic } from "../../types.ts";
import type { RuleContext } from "../../rule-engine.ts";
import type { DiagnosticTransform } from "./diagnostic-transform.ts";
import {
  appendPrecedent,
  renderPrecedentList,
  repositoryWorkflowPrecedents,
  repositoryJobPrecedents,
} from "./similar-workflow-consensus-shared.ts";

function rwp(
  entries: { workflowPath: string }[],
  lookup: ReadonlyMap<string, readonly string[]>,
  workflowPath: string,
): string[] {
  return repositoryWorkflowPrecedents(entries, workflowPath, lookup);
}

function rjp(
  entries: { workflowPath: string; jobId: string }[],
  lookup: ReadonlyMap<string, readonly string[]>,
  workflowPath: string,
  jobId: string,
): string[] {
  return repositoryJobPrecedents(entries, workflowPath, jobId, lookup);
}

export function withRepositoryConcurrencyPrecedent(
  context: RuleContext,
  workflowPath: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rwp(
      context.repository.repoPrecedents.concurrency,
      context.repository.repoPrecedents.lookups.concurrency,
      workflowPath,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already uses concurrency in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Reuse one of the repository's existing concurrency patterns where it fits this workflow."
        : undefined,
    );
  };
}

export function withRepositoryTimeoutPrecedent(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rjp(
      context.repository.repoPrecedents.timeoutMinutes,
      context.repository.repoPrecedents.lookups.timeoutMinutes,
      workflowPath,
      jobId,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already uses job-level timeout-minutes in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Use an existing timeout pattern in this repository as a starting point if it matches this job."
        : undefined,
    );
  };
}

export function withRepositoryDependencyCachePrecedent(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rjp(
      context.repository.repoPrecedents.dependencyCache,
      context.repository.repoPrecedents.lookups.dependencyCache,
      workflowPath,
      jobId,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already uses dependency caching in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Prefer copying an existing cache shape from this repository before adding a new one."
        : undefined,
    );
  };
}

export function withRepositoryShallowCheckoutPrecedent(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rjp(
      context.repository.repoPrecedents.shallowCheckout,
      context.repository.repoPrecedents.lookups.shallowCheckout,
      workflowPath,
      jobId,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already keeps checkout shallow in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Use one of the repository's existing shallow-checkout jobs as the baseline unless this job truly needs full history."
        : undefined,
    );
  };
}

export function withRepositoryPathsFilterPrecedent(
  context: RuleContext,
  workflowPath: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rwp(
      context.repository.repoPrecedents.pathsFilter,
      context.repository.repoPrecedents.lookups.pathsFilter,
      workflowPath,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already uses trigger path filters in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Use an existing paths/paths-ignore pattern from this repository as the starting point if it matches this workflow."
        : undefined,
    );
  };
}

export function withRepositorySetupCachePrecedent(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rjp(
      context.repository.repoPrecedents.setupCache,
      context.repository.repoPrecedents.lookups.setupCache,
      workflowPath,
      jobId,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already uses setup-action cache configuration in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Prefer an existing current setup-action-plus-cache pattern from this repository before introducing a new one."
        : undefined,
    );
  };
}

export function withRepositoryNonCodeIgnorePrecedent(
  context: RuleContext,
  workflowPath: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rwp(
      context.repository.repoPrecedents.nonCodeIgnore,
      context.repository.repoPrecedents.lookups.nonCodeIgnore,
      workflowPath,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already ignores obvious non-code changes in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Use an existing non-code paths-ignore pattern from this repository as the starting point if it matches this workflow."
        : undefined,
    );
  };
}

export function withRepositorySingleCacheStrategyPrecedent(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rjp(
      context.repository.repoPrecedents.setupCache,
      context.repository.repoPrecedents.lookups.setupCache,
      workflowPath,
      jobId,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already relies on setup-action cache without overlapping manual cache in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Prefer the repository's simpler setup-action cache pattern before keeping overlapping manual cache layers."
        : undefined,
    );
  };
}

export function withRepositoryReleaseDownstreamGuardPrecedent(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rjp(
      context.repository.repoPrecedents.releaseDownstreamSuccessGuard,
      context.repository.repoPrecedents.lookups.releaseDownstreamSuccessGuard,
      workflowPath,
      jobId,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already uses explicit downstream release success guards in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Use an existing guarded downstream release pattern from this repository as the starting point if it matches this job's intent."
        : undefined,
    );
  };
}

export function withRepositoryBlobNoneReleasePrecedent(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rjp(
      context.repository.repoPrecedents.blobNoneReleaseMetadata,
      context.repository.repoPrecedents.lookups.blobNoneReleaseMetadata,
      workflowPath,
      jobId,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already uses checkout \`filter: blob:none\` for release metadata jobs in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Use an existing blob:none release-metadata pattern from this repository as the baseline if this job has similar history-only needs."
        : undefined,
    );
  };
}

export function withRepositorySparseCheckoutPrecedent(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rjp(
      context.repository.repoPrecedents.sparseCheckoutScoped,
      context.repository.repoPrecedents.lookups.sparseCheckoutScoped,
      workflowPath,
      jobId,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already uses sparse-checkout for scoped history-aware jobs in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Use an existing sparse-checkout pattern from this repository as the baseline if this job has similar scoped working-tree needs."
        : undefined,
    );
  };
}

export function withRepositoryThrottledSchedulePrecedent(
  context: RuleContext,
  workflowPath: string,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    const precedents = rwp(
      context.repository.repoPrecedents.throttledHeavySchedule,
      context.repository.repoPrecedents.lookups.throttledHeavySchedule,
      workflowPath,
    );
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already keeps other heavy scheduled workflows at a slower cadence in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0
        ? "Use one of the repository's existing slower heavy-schedule patterns as a baseline if this workflow does not truly need its current frequency."
        : undefined,
    );
  };
}
