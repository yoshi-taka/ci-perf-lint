import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import { getRunsOnSpec, jobRunsOnDepotRunner } from "./runs-on-facts.ts";
import { shellInvocations } from "./shell-invocations.ts";
import { effectiveStepEnvironment } from "./workflow-env.ts";
import {
  declaredShellEnvironmentNames,
  declaredShellEnvironmentValues,
  githubEnvironmentValues,
} from "./shell-environment-evidence.ts";

export function firstXcodebuildStep(job: WorkflowJob): WorkflowStep | undefined {
  return job.steps.find((step) =>
    shellInvocations(step.run ?? "").some(
      ([tool, action]) => tool === "xcodebuild" || (tool === "xcrun" && action === "xcodebuild"),
    ),
  );
}

export function jobRunsDepotMacosXcode(job: WorkflowJob): boolean {
  const spec = getRunsOnSpec(job);
  return jobRunsOnDepotRunner(job) && spec.isMacos && Boolean(firstXcodebuildStep(job));
}

function isDisabled(value: unknown): boolean {
  return value === 0 || value === "0";
}

export function jobOptsOutOfDepotXcodeCache(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const run = step.run ?? "";
    const env = effectiveStepEnvironment(workflow, job, step);
    return (
      isDisabled(env.DEPOT_XCODE_CACHE_ENABLED) ||
      isDisabled(githubEnvironmentValues(run).DEPOT_XCODE_CACHE_ENABLED) ||
      isDisabled(declaredShellEnvironmentValues(run).DEPOT_XCODE_CACHE_ENABLED)
    );
  });
}

export function xcodebuildDisablesCaching(step: WorkflowStep): boolean {
  return shellInvocations(step.run ?? "").some((words) =>
    words.some((word) => /^COMPILATION_CACHE_ENABLE_CACHING=NO$/i.test(word)),
  );
}

export function jobOverridesXcodeConfigFile(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const run = step.run ?? "";
    return (
      "XCODE_XCCONFIG_FILE" in effectiveStepEnvironment(workflow, job, step) ||
      declaredShellEnvironmentNames(run).has("XCODE_XCCONFIG_FILE") ||
      "XCODE_XCCONFIG_FILE" in githubEnvironmentValues(run)
    );
  });
}
