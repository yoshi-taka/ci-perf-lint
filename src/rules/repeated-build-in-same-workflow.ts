import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectBuildTool } from "./shared/tools.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";

const meta = {
  id: "repeated-build-in-same-workflow",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/repeated-build-in-same-workflow.md",
} satisfies RuleMeta;

interface BuildOccurrence {
  jobId: string;
  step: WorkflowStep;
}

export const repeatedBuildInSameWorkflowRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const occurrencesByTool = new Map<string, BuildOccurrence[]>();

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || jobHasMatrix(job)) {
        continue;
      }

      const seenTools = new Set<string>();

      for (const step of job.steps) {
        const tool = detectBuildTool(step);
        if (!tool || seenTools.has(tool)) {
          continue;
        }

        seenTools.add(tool);
        const occurrences = occurrencesByTool.get(tool) ?? [];
        occurrences.push({ jobId: job.id, step });
        occurrencesByTool.set(tool, occurrences);
      }
    }

    return [...occurrencesByTool.entries()]
      .filter(([, occurrences]) => occurrences.length >= 2)
      .map(([tool, occurrences]) => {
        const jobIds = occurrences.map((occurrence) => occurrence.jobId).sort();
        const first = occurrences[0]!;

        return buildDiagnostic(workflow, meta, first.step.runNode ?? first.step.node, {
          message: `${tool} appears in multiple jobs (${jobIds.join(", ")}) within the same workflow.`,
          why: "Repeating the same build family across jobs can increase total runner time without adding new coverage.",
          suggestion:
            "Confirm whether the repeated build paths are intentionally different, or whether one shared build output would be enough.",
          measurementHint:
            "Compare workflow duration and runner minutes after removing or consolidating one duplicated build path.",
          aiHandoff: `Review repeated ${tool} execution in ${workflow.relativePath} across jobs ${jobIds.join(", ")} and consolidate only if the outputs are truly overlapping.`,
          score: 59,
        });
      });
  },
};
