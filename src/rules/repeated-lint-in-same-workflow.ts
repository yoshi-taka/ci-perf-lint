import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectLintTool, normalizeRunCommand } from "./shared/tools.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";

const meta = {
  id: "repeated-lint-in-same-workflow",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/repeated-lint-in-same-workflow.md",
} satisfies RuleMeta;

interface ToolOccurrence {
  jobId: string;
  step: WorkflowStep;
}

export const repeatedLintInSameWorkflowRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const occurrencesByTool = new Map<string, ToolOccurrence[]>();

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || jobHasMatrix(job)) {
        continue;
      }

      const seenSignaturesInJob = new Set<string>();

      for (const step of job.steps) {
        const tool = detectLintTool(step);
        if (!tool) {
          continue;
        }

        const run = normalizeRunCommand(step.run);
        const key = run ? `${tool}::${run}` : tool;
        if (seenSignaturesInJob.has(key)) {
          continue;
        }

        seenSignaturesInJob.add(key);
        const occurrences = occurrencesByTool.get(key) ?? [];
        occurrences.push({ jobId: job.id, step });
        occurrencesByTool.set(key, occurrences);
      }
    }

    return [...occurrencesByTool.entries()]
      .filter(([, occurrences]) => occurrences.length >= 2)
      .map(([tool, occurrences]) => {
        const jobIds = occurrences.map((occurrence) => occurrence.jobId).sort();
        const firstOccurrence = occurrences[0]!;
        return buildDiagnostic(
          workflow,
          meta,
          firstOccurrence.step.runNode ?? firstOccurrence.step.node,
          {
            message: `${tool} appears in multiple jobs (${jobIds.join(", ")}) within the same workflow and may partially overlap.`,
            why: "Repeating the same lint family across separate jobs can increase total runner time, but similarly named lint commands are sometimes intentionally scoped differently.",
            suggestion:
              "Confirm whether the repeated lint runs truly cover the same files or checks before consolidating anything.",
            measurementHint:
              "Compare workflow duration and runner minutes after removing or consolidating one of the duplicate lint paths.",
            aiHandoff: `Review repeated ${tool} execution in ${workflow.relativePath} across jobs ${jobIds.join(", ")} and consolidate only if the coverage is truly overlapping.`,
            score: 68,
          },
        );
      });
  },
};
