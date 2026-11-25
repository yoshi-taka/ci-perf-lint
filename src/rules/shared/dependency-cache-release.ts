import type { WorkflowDocument, WorkflowJob } from "../../workflow.ts";
import { getTriggerFacts } from "./trigger-facts.ts";
import { getWorkflowFacts } from "./workflow-analysis.ts";
import { shellInvocations } from "./shell-invocations.ts";

const releaseName =
  /(?:^|[\s_./-])(?:release|rollback|promote|nightly|tag|publish|version|deploy)(?:$|[\s_./-])/i;

/** Cache advice has a narrower exemption than checkout/release-safety rules. */
export function dependencyCacheJobIsReleaseLike(
  workflow: WorkflowDocument,
  job: WorkflowJob,
): boolean {
  // Preserve the existing behavior when no release marker excluded the job.
  const facts = getWorkflowFacts(workflow);
  if (!facts.looksReleaseLike && !facts.releaseLikeJobIds.has(job.id)) {
    return false;
  }
  const triggers = getTriggerFacts(workflow);
  const routinelyTriggered = triggers.hasPullRequest || triggers.push.hasBranchPush;
  if (
    !routinelyTriggered ||
    job.ifNode ||
    releaseName.test(workflow.name ?? "") ||
    releaseName.test(job.id) ||
    (typeof job.raw.name === "string" && releaseName.test(job.raw.name))
  ) {
    return true;
  }
  // A mixed-trigger workflow can still contain an unconditionally publishing job.
  // Never infer that it is validation-only just because its ID is "build".
  return job.steps.some((step) => {
    const uses = step.uses?.toLowerCase() ?? "";
    if (
      releaseName.test(step.name ?? "") ||
      /^(?:softprops\/action-gh-release|pypa\/gh-action-pypi-publish|js-devtools\/npm-publish|changesets\/action)@/.test(
        uses,
      ) ||
      (step.with?.push !== undefined && step.with.push !== false && step.with.push !== "false") ||
      step.with?.publish !== undefined
    ) {
      return true;
    }
    return shellInvocations(step.run ?? "").some(
      ([tool, command, ...args]) =>
        releaseName.test(tool ?? "") ||
        (["npm", "pnpm", "yarn", "bun"].includes(tool ?? "") &&
          (["publish", "version"].includes(command ?? "") ||
            (command === "run" && releaseName.test(args[0] ?? "")))) ||
        (tool === "twine" && command === "upload") ||
        (tool === "gh" && command === "release") ||
        (tool === "docker" && (command === "push" || args.includes("--push"))),
    );
  });
}
