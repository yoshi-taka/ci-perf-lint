import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectLintTool, normalizeRunCommand } from "./shared/tools.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";
import {
  buildStepSequence,
  computePairProximity,
  type StepPosition,
} from "./shared/step-proximity.ts";

const REPEATED_PROXIMITY_THRESHOLD = 0.3;

const meta = {
  id: "repeated-lint-in-same-workflow",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/repeated-lint-in-same-workflow.md",
} satisfies RuleMeta;

interface ToolOccurrence {
  jobId: string;
  step: WorkflowStep;
  position: StepPosition;
}

export const repeatedLintInSameWorkflowRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const seq = buildStepSequence(workflow);
    const positionByJobStep = new Map<string, StepPosition>();
    for (const pos of seq.positions) {
      positionByJobStep.set(`${pos.jobId}:${pos.jobStepIndex}`, pos);
    }

    const occurrencesByTool = new Map<string, ToolOccurrence[]>();

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || jobHasMatrix(job)) {
        continue;
      }

      const seenSignaturesInJob = new Set<string>();

      for (let stepIdx = 0; stepIdx < job.steps.length; stepIdx++) {
        const step = job.steps[stepIdx]!;
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
        const pos = positionByJobStep.get(`${job.id}:${stepIdx}`);
        if (!pos) {
          continue;
        }

        const occurrences = occurrencesByTool.get(key) ?? [];
        occurrences.push({ jobId: job.id, step, position: pos });
        occurrencesByTool.set(key, occurrences);
      }
    }

    return [...occurrencesByTool.entries()]
      .filter(([, occurrences]) => {
        if (occurrences.length < 2) {
          return false;
        }
        let maxProx = 0;
        for (let i = 0; i < occurrences.length; i++) {
          for (let j = i + 1; j < occurrences.length; j++) {
            const prox = computePairProximity(
              occurrences[i]!.position,
              occurrences[j]!.position,
              seq.boundaries,
            );
            if (prox > maxProx) {
              maxProx = prox;
            }
          }
        }
        return maxProx >= REPEATED_PROXIMITY_THRESHOLD;
      })
      .map(([tool, occurrences]) => {
        const jobIds = occurrences.map((occ) => occ.jobId).sort();
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
