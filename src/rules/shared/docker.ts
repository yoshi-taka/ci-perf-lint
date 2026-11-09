import type { WorkflowJob, WorkflowStep } from "../../workflow.ts";
import type { AnyStep } from "./any-step.ts";
import { getJobFacts } from "./workflow-analysis.ts";
import { getStepCommandText } from "./any-step.ts";
import { dockerBuildArguments, dockerBuildFlag } from "./docker-build-commands.ts";

export function stepDisablesDockerBuildCache(step: WorkflowStep | AnyStep): boolean {
  const uses = "uses" in step ? (step.uses?.toLowerCase() ?? "") : "";
  if (uses.startsWith("docker/build-push-action@") || uses.startsWith("depot/build-push-action@")) {
    const withVal = "with" in step ? step.with : undefined;
    const noCache = withVal?.["no-cache"];
    return (
      noCache === true || (typeof noCache === "string" && noCache.trim().toLowerCase() === "true")
    );
  }

  return textDisablesDockerBuildCache(getStepCommandText(step));
}

export function jobRunsBuildxBake(job: WorkflowJob): boolean {
  return getJobFacts(job).hasBuildxBake;
}

export function textDisablesDockerBuildCache(text: string): boolean {
  return dockerBuildArguments(text).some((args) => dockerBuildFlag(args, "--no-cache"));
}

export function textRunsDockerBuild(text: string): boolean {
  return dockerBuildArguments(text).length > 0;
}
