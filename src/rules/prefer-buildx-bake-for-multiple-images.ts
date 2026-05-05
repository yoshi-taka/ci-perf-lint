import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobRunsBuildxBake, stepRunsDockerBuild } from "./shared/docker.ts";

const meta = {
  id: "prefer-buildx-bake-for-multiple-images",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-buildx-bake-for-multiple-images.md",
} satisfies RuleMeta;

export const preferBuildxBakeForMultipleImagesRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || jobRunsBuildxBake(job)) {
        continue;
      }

      const buildSteps = job.steps.filter((step) => stepRunsDockerBuild(step));
      if (buildSteps.length < 2) {
        continue;
      }

      const firstStep: WorkflowStep | undefined = buildSteps[0];
      findings.push(
        buildDiagnostic(
          workflow,
          meta,
          firstStep?.runNode ?? firstStep?.usesNode ?? firstStep?.node,
          {
            message: `Job "${job.id}" builds ${buildSteps.length} Docker images or targets without using \`docker buildx bake\`.`,
            why: "Multiple separate Docker build invocations make CI own scheduling and dependency ordering. buildx bake can model the image set as one BuildKit graph, enabling shared configuration, parallel execution, and target dependencies.",
            suggestion:
              "Move repeated Docker image builds into a docker-bake.hcl target or group and invoke `docker buildx bake` from CI.",
            measurementHint:
              "Compare Docker build wall-clock time and runner minutes before and after replacing repeated build commands with buildx bake.",
            aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and replace repeated Docker build invocations with a \`docker-bake.hcl\` group plus \`docker buildx bake\` where the images are part of the same release set.`,
            score: 71,
          },
        ),
      );
    }
    return findings;
  },
};
