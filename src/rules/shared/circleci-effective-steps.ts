import type { CircleCiDocument, CircleCiJob, CircleCiStep } from "../../circleci-workflow.ts";
import type { CircleCiWorkflowInvocation } from "../../circleci-workflow-graph.ts";
import { expandCircleCiStepNodes } from "../../circleci-command-expansion.ts";
import type { Node } from "../../yaml.ts";
import { collectCircleCiWorkflowInvocations } from "../../circleci-workflow-graph.ts";

/**
 * Effective steps for one workflow invocation: pre-steps, the job body
 * re-expanded with invocation parameters, and post-steps. Returns undefined
 * when `override-with` replaces the local job with an opaque orb job.
 */
export function effectiveInvocationSteps(
  doc: CircleCiDocument,
  job: CircleCiJob,
  invocation: CircleCiWorkflowInvocation,
): CircleCiStep[] | undefined {
  if (invocation.overrideWith) {
    return undefined;
  }
  const bodyNode = job.node.get("steps", true) as Node | undefined;
  const body = expandCircleCiStepNodes(doc, bodyNode, invocation.parameters);
  const pre = expandCircleCiStepNodes(doc, invocation.preSteps, invocation.parameters);
  const post = expandCircleCiStepNodes(doc, invocation.postSteps, invocation.parameters);
  return [...pre, ...body, ...post];
}

/** True when every workflow invocation of a job replaces it with an orb job. */
export function jobIsFullyOverridden(doc: CircleCiDocument, jobName: string): boolean {
  const invocations = collectCircleCiWorkflowInvocations(doc).filter(
    (invocation) => invocation.jobName === jobName,
  );
  return (
    invocations.length > 0 && invocations.every((invocation) => Boolean(invocation.overrideWith))
  );
}

export function invocationCacheSteps(
  doc: CircleCiDocument,
  job: CircleCiJob,
  invocation: CircleCiWorkflowInvocation,
): CircleCiStep[] | undefined {
  return effectiveInvocationSteps(doc, job, invocation)?.filter(
    (step) => step.type === "restore_cache" || step.type === "save_cache",
  );
}
