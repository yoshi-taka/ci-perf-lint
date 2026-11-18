import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import type { YAMLMap } from "../../yaml.ts";
import { getScalarValue, getMapValue, getNode } from "../../workflow.ts";
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

function stepEnvText(step: WorkflowStep): string {
  const env = getNode(step.node, "env")?.toJSON();
  return env && typeof env === "object" ? JSON.stringify(env) : "";
}

function jobOutputs(job: WorkflowJob): Record<string, unknown> | undefined {
  const outputs = getNode(job.node, "outputs")?.toJSON();
  return outputs && typeof outputs === "object" && !Array.isArray(outputs)
    ? (outputs as Record<string, unknown>)
    : undefined;
}

function jobConditionText(job: WorkflowJob): string {
  return [
    typeof job.raw.if === "string" ? job.raw.if : "",
    ...job.steps.map((step) => `${step.if ?? ""} ${stepEnvText(step)}`),
  ].join(" ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Producer jobs whose `outputs` gate other jobs through
 * `needs.<producer>.outputs.*` conditions — a planner, dorny-paths-filter,
 * or determinator lane. A producer qualifies when at least three jobs and
 * two-fifths of the workflow consume its outputs, the same calibration the
 * trigger-filter rule uses to abstain (iyi's ci_plan, warp's params, rue's
 * affected-targets are real examples).
 */
export function workflowChangeSelectionProducerIds(
  workflow: WorkflowDocument,
): ReadonlySet<string> {
  const qualifying = new Set<string>();
  const jobs = workflow.jobs;
  for (const producer of jobs) {
    if (Object.keys(jobOutputs(producer) ?? {}).length === 0) {
      continue;
    }
    const pattern = new RegExp(`needs\\.${escapeRegex(producer.id)}\\.outputs\\.`);
    let consumers = 0;
    for (const job of jobs) {
      if (job.id !== producer.id && pattern.test(jobConditionText(job))) {
        consumers++;
      }
    }
    if (consumers >= 3 && consumers * 5 >= jobs.length * 2) {
      qualifying.add(producer.id);
    }
  }
  return qualifying;
}
