import type { Node } from "../../yaml.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import { getNode } from "../../workflow.ts";
import { getRunsOnSpec, jobRunsOnDepotRunner } from "./runs-on-facts.ts";
import { shellInvocations } from "./shell-invocations.ts";
import { effectiveStepEnvironment } from "./workflow-env.ts";
import {
  declaredShellEnvironmentValues,
  githubEnvironmentValues,
} from "./shell-environment-evidence.ts";
import { shellCommandSegments, shellCommands } from "./command-patterns.ts";
import { shellExecutionTexts } from "./shell-execution-text.ts";

export function xcodebuildSteps(job: WorkflowJob): WorkflowStep[] {
  return job.steps.filter((step) =>
    shellInvocations(step.run ?? "").some(
      ([tool, action]) => tool === "xcodebuild" || (tool === "xcrun" && action === "xcodebuild"),
    ),
  );
}

export function firstXcodebuildStep(job: WorkflowJob): WorkflowStep | undefined {
  return xcodebuildSteps(job)[0];
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

function assignsBeforeXcodebuild(run: string, name: string): boolean {
  for (const segment of shellExecutionTexts(run).flatMap(shellCommandSegments)) {
    const words = shellCommands(segment)[0] ?? [];
    const buildIndex = words.findIndex(
      (word, index) =>
        word === "xcodebuild" || (word === "xcrun" && words[index + 1] === "xcodebuild"),
    );
    const limit = buildIndex >= 0 ? buildIndex : words.length;
    let index = ["export", "env", "readonly"].includes(words[0] ?? "") ? 1 : 0;
    for (; index < limit; index++) {
      const match = /^([A-Za-z_]\w*)=/.exec(words[index]!);
      if (!match) {
        break;
      }
      if (match[1] === name) {
        return true;
      }
    }
    if (buildIndex >= 0) {
      return false;
    }
  }
  return false;
}

/**
 * Only overrides visible to this xcodebuild step count: its effective env,
 * an assignment/export before the command in the same script, or a GITHUB_ENV
 * write by an earlier step. A write after the build or in another step's env
 * does not affect the build and is reported as no finding.
 */
export function xcconfigOverrideForStep(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
): { node: Node | undefined } | undefined {
  if ("XCODE_XCCONFIG_FILE" in effectiveStepEnvironment(workflow, job, step)) {
    const node =
      getNode(step.node, "env") ??
      (job.node.get("env", true) as Node | undefined) ??
      (workflow.root?.get("env", true) as Node | undefined) ??
      step.node;
    return { node };
  }
  if (assignsBeforeXcodebuild(step.run ?? "", "XCODE_XCCONFIG_FILE")) {
    return { node: step.runNode ?? step.node };
  }
  const index = job.steps.indexOf(step);
  for (const previous of job.steps.slice(0, index)) {
    if ("XCODE_XCCONFIG_FILE" in githubEnvironmentValues(previous.run ?? "")) {
      return { node: previous.runNode ?? previous.node };
    }
  }
  return undefined;
}
