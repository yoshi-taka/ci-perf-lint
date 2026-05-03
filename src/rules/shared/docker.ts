import type { WorkflowJob, WorkflowStep } from "../../workflow.ts";
import type { AnyStep } from "./any-step.ts";
import { getJobAnalysis } from "./workflow-analysis.ts";
import { getStepCommandText } from "./any-step.ts";

export function stepRunsDockerBuild(step: WorkflowStep | AnyStep): boolean {
  const uses = "uses" in step ? (step.uses?.toLowerCase() ?? "") : "";
  if (uses.startsWith("docker/build-push-action@")) {
    return true;
  }

  return /\bdocker\s+(?:buildx\s+build|build)\b/i.test(getStepCommandText(step));
}

export function stepDisablesDockerBuildCache(step: WorkflowStep | AnyStep): boolean {
  const uses = "uses" in step ? (step.uses?.toLowerCase() ?? "") : "";
  if (uses.startsWith("docker/build-push-action@") || uses.startsWith("depot/build-push-action@")) {
    const withVal = "with" in step ? step.with : undefined;
    const noCache = withVal?.["no-cache"];
    return (
      noCache === true || (typeof noCache === "string" && noCache.trim().toLowerCase() === "true")
    );
  }

  return /\b(?:docker\s+(?:buildx\s+build|build)|depot\s+build)\b[\s\S]*\s--no-cache(?:\s|$)/i.test(
    getStepCommandText(step),
  );
}

export function stepRunsLegacyDockerBuild(step: WorkflowStep | AnyStep): boolean {
  return /\bdocker\s+build\b/i.test(getStepCommandText(step));
}

export function jobRunsBuildxBake(job: WorkflowJob): boolean {
  return getJobAnalysis(job).hasBuildxBake;
}

export function textDisablesDockerBuildCache(text: string): boolean {
  return /\b(?:docker\s+(?:buildx\s+build|build)|depot\s+build)\b[\s\S]*\s--no-cache(?:\s|$)/i.test(
    text,
  );
}

export function textRunsDockerBuild(text: string): boolean {
  return /\bdocker\s+(?:buildx\s+build|build)\b/i.test(text);
}
