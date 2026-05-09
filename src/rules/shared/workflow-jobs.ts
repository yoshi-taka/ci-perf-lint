import type { WorkflowDocument, WorkflowJob } from "../../workflow.ts";
import type { YAMLMap } from "yaml";
import { getScalarValue, getMapValue } from "../../workflow.ts";
import { getJobFacts, getWorkflowFacts } from "./workflow-analysis.ts";

export function isHeavyWorkflow(workflow: WorkflowDocument): boolean {
  return getWorkflowFacts(workflow).isHeavyWorkflow;
}

export function isHeavyJob(job: WorkflowJob): boolean {
  return getJobFacts(job).isHeavyJob;
}

export function hasDirectHeavySignals(job: WorkflowJob): boolean {
  return getJobFacts(job).hasDirectHeavySignals;
}

export function workflowHasConcurrency(workflow: WorkflowDocument): boolean {
  return getWorkflowFacts(workflow).hasConcurrency;
}

export function workflowJobCount(workflow: WorkflowDocument): number {
  return workflow.jobs.length;
}

export function jobHasMatrix(job: WorkflowJob): boolean {
  if (!isYamlMap(job.node)) {
    const strategy = job.raw.strategy;
    if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) {
      return false;
    }
    const matrix = (strategy as Record<string, unknown>).matrix;
    return Boolean(matrix) && typeof matrix === "object";
  }
  const strategy = getMapValue(job.node, "strategy");
  if (!strategy) {
    return false;
  }
  const matrix = strategy.matrix;
  return Boolean(matrix) && typeof matrix === "object";
}

export function jobHasTimeout(job: WorkflowJob): boolean {
  if (!isYamlMap(job.node)) {
    const timeout = job.raw["timeout-minutes"];
    return (
      typeof timeout === "number" || (typeof timeout === "string" && timeout.trim().length > 0)
    );
  }
  const timeout = getScalarValue(job.node, "timeout-minutes");
  return typeof timeout === "number" || (typeof timeout === "string" && timeout.trim().length > 0);
}

export function jobIsStaticallyDisabled(job: WorkflowJob): boolean {
  if (!isYamlMap(job.node)) {
    const ifValue = job.raw.if;
    return ifValue === false || (typeof ifValue === "string" && ifValue.trim() === "false");
  }
  const ifValue = getScalarValue(job.node, "if");
  return ifValue === false || (typeof ifValue === "string" && ifValue.trim() === "false");
}

function isYamlMap(node: unknown): node is YAMLMap<unknown, unknown> {
  return Boolean(node && typeof node === "object" && "items" in (node as Record<string, unknown>));
}

export function jobRunsOnHostedUbuntu(job: WorkflowJob): boolean {
  return getJobFacts(job).runsOnSpec.isUbuntu;
}

export function jobRunsOnHostedWindows(job: WorkflowJob): boolean {
  return getJobFacts(job).runsOnSpec.isWindows;
}

export function jobRunsOnHostedMacos(job: WorkflowJob): boolean {
  return getJobFacts(job).runsOnSpec.isMacos;
}

export function jobRunsOnStandardHostedRunner(job: WorkflowJob): boolean {
  return getJobFacts(job).runsOnSpec.isStandardHosted;
}

export function jobUsesContainer(job: WorkflowJob): boolean {
  return getJobFacts(job).runsOnSpec.usesContainer;
}

export function hasHistoryDependentCommand(job: WorkflowJob): boolean {
  return getJobFacts(job).hasHistoryDependentCommand;
}

export function hasOpaqueRepoScriptExecution(job: WorkflowJob): boolean {
  return getJobFacts(job).hasOpaqueRepoScriptExecution;
}

export function jobPublishesScorecardResults(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const uses = step.uses?.toLowerCase() ?? "";
    if (!uses.startsWith("ossf/scorecard-action@")) {
      return false;
    }
    return step.with?.publish_results === true || step.with?.publish_results === "true";
  });
}

export function workflowLooksReleaseLike(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  return getJobFacts(job).looksReleaseLike;
}

export function workflowLooksMetaCheckLike(workflow: WorkflowDocument): boolean {
  return getWorkflowFacts(workflow).looksMetaCheckLike;
}

export function workflowLooksAgenticLike(workflow: WorkflowDocument, job?: WorkflowJob): boolean {
  return job
    ? getJobFacts(job).looksAgenticLike || getWorkflowFacts(workflow).looksAgenticLike
    : getWorkflowFacts(workflow).looksAgenticLike;
}
