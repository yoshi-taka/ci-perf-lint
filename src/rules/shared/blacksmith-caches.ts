import type { WorkflowJob, WorkflowStep } from "../../workflow.ts";
import { jobRunsOnBlacksmithRunner } from "./runs-on-facts.ts";
import { staticShellWords } from "./command-patterns.ts";

function stickyDiskContainerConfigured(job: WorkflowJob): boolean {
  const container = job.raw.container;
  if (!container) {
    return true;
  }
  if (typeof container !== "object" || Array.isArray(container)) {
    return false;
  }
  const { options, env } = container as Record<string, unknown>;
  const words = typeof options === "string" ? staticShellWords(options) : undefined;
  return (
    words?.includes("--privileged") === true &&
    !words.includes("--privileged=false") &&
    env !== null &&
    typeof env === "object" &&
    [
      "VM_ID",
      "GITHUB_REPO_NAME",
      "BLACKSMITH_STICKYDISK_TOKEN",
      "BLACKSMITH_INSTALLATION_MODEL_ID",
      "BLACKSMITH_REGION",
    ].every(
      (name) =>
        typeof (env as Record<string, unknown>)[name] === "string" &&
        ((env as Record<string, unknown>)[name] as string).trim() !== "",
    )
  );
}

/** Visible host-side persistence, not proof of a cache hit or dashboard configuration. */
export function isBlacksmithStickyDiskCacheStep(job: WorkflowJob, step: WorkflowStep): boolean {
  const key = step.with?.key;
  const cachePath = step.with?.path;
  return (
    jobRunsOnBlacksmithRunner(job) &&
    stickyDiskContainerConfigured(job) &&
    !step.ifNode &&
    /^useblacksmith\/stickydisk@/i.test(step.uses ?? "") &&
    typeof key === "string" &&
    key.trim() !== "" &&
    typeof cachePath === "string" &&
    !/[\r\n]/.test(cachePath) &&
    cachePath.trim() !== ""
  );
}
