import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";
import { comparableBuilds } from "./shared/repeated-build-context.ts";

const meta = {
  id: "repeated-build-in-same-workflow",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/repeated-build-in-same-workflow.md",
} satisfies RuleMeta;

interface BuildOccurrence {
  jobId: string;
  step: WorkflowStep;
  tool: string;
}

export const repeatedBuildInSameWorkflowRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const occurrencesByInputs = new Map<string, Map<string, BuildOccurrence>>();

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || jobHasMatrix(job)) {
        continue;
      }

      for (const { key, step, tool } of comparableBuilds(workflow, job)) {
        const occurrences = occurrencesByInputs.get(key) ?? new Map<string, BuildOccurrence>();
        occurrences.set(job.id, { jobId: job.id, step, tool });
        occurrencesByInputs.set(key, occurrences);
      }
    }

    return [...occurrencesByInputs.values()]
      .filter((occurrences) => occurrences.size >= 2)
      .map((group) => {
        const occurrences = [...group.values()];
        const jobIds = occurrences.map((occ) => occ.jobId).sort();
        const first = occurrences[0]!;

        return buildDiagnostic(workflow, meta, first.step.runNode ?? first.step.node, {
          message: `Jobs (${jobIds.join(", ")}) repeat the same ${first.tool} command with matching visible build inputs.`,
          why: "Checkout, working directory, command, runner, setup sequence and environment match. Rebuilding may repeat work, but this does not prove artifact equivalence or that downstream validation is redundant.",
          suggestion:
            "Consider sharing build artifacts while preserving each job's downstream tests and isolation. Compare artifact upload/download overhead with the avoided build time.",
          measurementHint:
            "Compare workflow duration and runner minutes after removing or consolidating one duplicated build path.",
          aiHandoff: `Review matching ${first.tool} build inputs in ${workflow.relativePath} jobs ${jobIds.join(", ")}. Share outputs only after verifying artifact compatibility, preserving downstream checks, and measuring total runner time.`,
          score: 59,
        });
      });
  },
};
