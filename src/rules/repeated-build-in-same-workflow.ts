import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectBuildTool } from "./shared/tools.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";
import {
  buildStepSequence,
  computePairProximity,
  type StepPosition,
} from "./shared/step-proximity.ts";

const REPEATED_PROXIMITY_THRESHOLD = 0.3;

const meta = {
  id: "repeated-build-in-same-workflow",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/repeated-build-in-same-workflow.md",
} satisfies RuleMeta;

interface BuildOccurrence {
  jobId: string;
  step: WorkflowStep;
  position: StepPosition;
}

export const repeatedBuildInSameWorkflowRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const seq = buildStepSequence(workflow);
    const positionByJobStep = new Map<string, StepPosition>();
    for (const pos of seq.positions) {
      positionByJobStep.set(`${pos.jobId}:${pos.jobStepIndex}`, pos);
    }

    const occurrencesByTool = new Map<string, BuildOccurrence[]>();

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || jobHasMatrix(job)) {
        continue;
      }

      const seenTools = new Set<string>();

      for (let stepIdx = 0; stepIdx < job.steps.length; stepIdx++) {
        const step = job.steps[stepIdx]!;
        const tool = detectBuildTool(step);
        if (!tool || seenTools.has(tool)) {
          continue;
        }

        seenTools.add(tool);
        const pos = positionByJobStep.get(`${job.id}:${stepIdx}`);
        if (!pos) {
          continue;
        }

        const occurrences = occurrencesByTool.get(tool) ?? [];
        occurrences.push({ jobId: job.id, step, position: pos });
        occurrencesByTool.set(tool, occurrences);
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
