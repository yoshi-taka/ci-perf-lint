import type { WorkflowDocument, WorkflowJob } from "../../workflow.ts";
import type { YAMLMap } from "yaml";
import { getNode, getScalarValue, getMapValue, getStringOrArrayValue } from "../../workflow.ts";
import { getJobAnalysis, getWorkflowAnalysis } from "./workflow-analysis.ts";

export function isHeavyWorkflow(workflow: WorkflowDocument): boolean {
  return getWorkflowAnalysis(workflow).isHeavyWorkflow;
}

export function isHeavyJob(job: WorkflowJob): boolean {
  return getJobAnalysis(job).isHeavyJob;
}

export function hasDirectHeavySignals(job: WorkflowJob): boolean {
  return getJobAnalysis(job).hasDirectHeavySignals;
}

export function workflowHasConcurrency(workflow: WorkflowDocument): boolean {
  return getWorkflowAnalysis(workflow).hasConcurrency;
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

function getRunsOnLabels(job: WorkflowJob): string[] {
  if (!isYamlMap(job.node)) {
    const runsOn = job.raw["runs-on"];
    if (typeof runsOn === "string") {
      return [runsOn];
    }
    if (Array.isArray(runsOn)) {
      return runsOn.filter((e): e is string => typeof e === "string");
    }
    return [];
  }
  const runsOn = getStringOrArrayValue(job.node, "runs-on");
  if (typeof runsOn === "string") {
    return [runsOn];
  }
  if (Array.isArray(runsOn)) {
    return runsOn.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

export function jobRunsOnHostedUbuntu(job: WorkflowJob): boolean {
  return getRunsOnLabels(job).some((label) => /^ubuntu-/i.test(label));
}

export function jobRunsOnHostedWindows(job: WorkflowJob): boolean {
  return getRunsOnLabels(job).some((label) => /^windows-/i.test(label));
}

export function jobRunsOnHostedMacos(job: WorkflowJob): boolean {
  return getRunsOnLabels(job).some((label) => /^macos-/i.test(label));
}

const standardHostedRunnerLabels = new Set([
  "ubuntu-latest",
  "ubuntu-24.04",
  "ubuntu-22.04",
  "ubuntu-20.04",
  "windows-latest",
  "windows-2025",
  "windows-2022",
  "windows-2019",
  "macos-latest",
  "macos-14",
  "macos-15",
  "macos-26",
  "macos-15-intel",
  "macos-26-intel",
]);

export function jobRunsOnStandardHostedRunner(job: WorkflowJob): boolean {
  if (!isYamlMap(job.node)) {
    const runsOn = job.raw["runs-on"];
    if (typeof runsOn === "string") {
      return standardHostedRunnerLabels.has(runsOn.toLowerCase());
    }
    if (Array.isArray(runsOn)) {
      const labels = runsOn
        .filter((e): e is string => typeof e === "string")
        .map((l) => l.toLowerCase());
      return labels.length > 0 && labels.every((l) => standardHostedRunnerLabels.has(l));
    }
    return false;
  }
  const runsOn = getStringOrArrayValue(job.node, "runs-on");
  if (typeof runsOn === "string") {
    return standardHostedRunnerLabels.has(runsOn.toLowerCase());
  }

  if (Array.isArray(runsOn)) {
    const labels = runsOn
      .filter((entry): entry is string => typeof entry === "string")
      .map((label) => label.toLowerCase());
    if (labels.length === 0) {
      return false;
    }

    return labels.every((label) => standardHostedRunnerLabels.has(label));
  }

  return false;
}

export function jobUsesContainer(job: WorkflowJob): boolean {
  if (!isYamlMap(job.node)) {
    return Boolean(job.raw.container);
  }
  return getNode(job.node, "container") !== undefined;
}

export function hasHistoryDependentCommand(job: WorkflowJob): boolean {
  return getJobAnalysis(job).hasHistoryDependentCommand;
}

export function hasOpaqueRepoScriptExecution(job: WorkflowJob): boolean {
  return getJobAnalysis(job).hasOpaqueRepoScriptExecution;
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
  const workflowName = workflow.name?.toLowerCase() ?? "";
  const jobId = job.id.toLowerCase();

  if (/\b(release|rollback|promote|nightly|tag|version)\b/.test(workflowName)) {
    return true;
  }

  if (/\b(release|rollback|promote|nightly|tag|publish|version)\b/.test(jobId)) {
    return true;
  }

  const onRecord =
    workflow.on && typeof workflow.on === "object" && !Array.isArray(workflow.on)
      ? (workflow.on as Record<string, unknown>)
      : undefined;
  const pushConfig =
    onRecord?.push && typeof onRecord.push === "object" && !Array.isArray(onRecord.push)
      ? (onRecord.push as Record<string, unknown>)
      : undefined;

  return Array.isArray(pushConfig?.tags) || Array.isArray(pushConfig?.["tags-ignore"]);
}

export function workflowLooksMetaCheckLike(workflow: WorkflowDocument): boolean {
  return getWorkflowAnalysis(workflow).looksMetaCheckLike;
}

export function workflowLooksAgenticLike(workflow: WorkflowDocument, job?: WorkflowJob): boolean {
  return job
    ? getJobAnalysis(job).looksAgenticLike || getWorkflowAnalysis(workflow).looksAgenticLike
    : getWorkflowAnalysis(workflow).looksAgenticLike;
}
