import type { WorkflowDocument } from "../../workflow.ts";
import type { PipelineDocument } from "../../buildkite-workflow.ts";
import type { GitlabCiDocument } from "../../gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "../../circleci-workflow.ts";
import { getStepFacts } from "./step-facts.ts";
import { getJobFacts, getWorkflowFacts } from "./workflow-analysis.ts";
import { buildWorkflowSemantics } from "./workflow-semantics.ts";

export function prewarmStepAnalysisCaches(
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
): void {
  getWorkflowFacts(workflow);

  if ("steps" in workflow && !("jobs" in workflow)) {
    return;
  }
  if ("kind" in workflow) {
    return;
  }

  const wf = workflow as WorkflowDocument;
  for (const job of wf.jobs) {
    getJobFacts(job);
    for (const step of job.steps) {
      getStepFacts(step);
    }
  }

  buildWorkflowSemantics(wf);
}
