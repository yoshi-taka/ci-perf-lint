import type { AnyWorkflowDocument } from "../../ci-types.ts";
import type { WorkflowDocument } from "../../workflow.ts";
import { getStepFacts } from "./step-facts.ts";
import { getJobFacts, getWorkflowFacts } from "./workflow-analysis.ts";
import { buildWorkflowSemantics } from "./workflow-semantics.ts";

export function prewarmStepAnalysisCaches(workflow: AnyWorkflowDocument): void {
  getWorkflowFacts(workflow);

  if (workflow.kind !== "github-actions") {
    return;
  }

  const wf: WorkflowDocument = workflow;
  for (const job of wf.jobs) {
    getJobFacts(job);
    for (const step of job.steps) {
      getStepFacts(step);
    }
  }

  buildWorkflowSemantics(wf);
}
