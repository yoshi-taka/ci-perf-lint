import { getScalarValue, type WorkflowJob, type WorkflowStep } from "../../workflow.ts";

/**
 * Conditions that keep a step or job from ever executing on pull_request
 * runs. Expressions embedding these guards inside an input value (for
 * example anthropics/buffa's push-only cache export) count too.
 */
const PULL_REQUEST_EXCLUDING_PATTERN =
  /github\.event_name\s*(?:==\s*['"](?:push|workflow_dispatch|schedule)['"]|!=\s*['"]pull_request['"])|github\.ref\s*==\s*['"]refs\/heads\//;

export function excludesPullRequestRuns(text: string | undefined): boolean {
  return typeof text === "string" && PULL_REQUEST_EXCLUDING_PATTERN.test(text);
}

export function stepEnabledOnPullRequests(step: WorkflowStep): boolean {
  if (getScalarValue(step.node, "if") === false || step.if?.trim() === "false") {
    return false;
  }
  return step.if === undefined || !excludesPullRequestRuns(step.if);
}

export function jobEnabledOnPullRequests(job: WorkflowJob): boolean {
  const jobIf = job.raw.if;
  return typeof jobIf !== "string" || !excludesPullRequestRuns(jobIf);
}
