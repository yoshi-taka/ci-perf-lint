import type { WorkflowDocument } from "../../workflow.ts";
import type { PipelineDocument } from "../../buildkite-workflow.ts";
import type { GitlabCiDocument } from "../../gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "../../circleci-workflow.ts";
import { getJobAnalysis, getWorkflowAnalysis } from "./workflow-analysis.ts";
import { detectInstallCommand, detectLintTool, detectBuildTool, detectPythonTool, detectRedundantBootstrapTool } from "./tools.ts";
import { isManualCacheStep, hasDependencyCacheConfig } from "./workflow-caches.ts";
import { getSetupActionKind } from "./workflow-setup-actions.ts";
import { getWorkflowStepText, getLoweredWorkflowStepText } from "./workflow-step-text.ts";

export function prewarmStepAnalysisCaches(
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
): void {
  getWorkflowAnalysis(workflow);

  if ("steps" in workflow && !("jobs" in workflow)) {
    return;
  }
  if ("kind" in workflow) {
    return;
  }

  const wf = workflow as WorkflowDocument;
  for (const job of wf.jobs) {
    getJobAnalysis(job);
    for (const step of job.steps) {
      getWorkflowStepText(step);
      getLoweredWorkflowStepText(step);
      getSetupActionKind(step);
      detectInstallCommand(step);
      detectLintTool(step);
      detectBuildTool(step);
      detectPythonTool(step);
      detectRedundantBootstrapTool(step);
      isManualCacheStep(step);
      hasDependencyCacheConfig(step);
    }
  }
}
