import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "prefer-zstd-compression-for-pushed-docker-images",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-zstd-compression-for-pushed-docker-images.md",
} satisfies RuleMeta;

function withString(step: WorkflowStep, key: string): string {
  const value = step.with?.[key];
  return typeof value === "string" ? value : "";
}

function stepUsesDockerOrDepotBuildPushAction(step: WorkflowStep): boolean {
  const uses = step.uses?.toLowerCase() ?? "";
  return (
    uses.startsWith("docker/build-push-action@") || uses.startsWith("depot/build-push-action@")
  );
}

function actionStepPushesImage(step: WorkflowStep): boolean {
  const push = step.with?.push;
  return (
    push === true ||
    withString(step, "push").trim().toLowerCase() === "true" ||
    withString(step, "outputs").includes("type=registry")
  );
}

function actionStepUsesZstd(step: WorkflowStep): boolean {
  const outputs = withString(step, "outputs");
  return /\bcompression=zstd\b/i.test(outputs) && /\boci-mediatypes=true\b/i.test(outputs);
}

function shellStepBuildsAndPushesWithBuildKit(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  return (
    /\b(?:docker\s+buildx|depot)\s+build\b/i.test(run) &&
    /\s--push(?:\s|$)|type=registry/i.test(run)
  );
}

function shellStepUsesZstd(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  return /\bcompression=zstd\b/i.test(run) && /\boci-mediatypes=true\b/i.test(run);
}

function findMissingZstdStep(jobSteps: WorkflowStep[]): WorkflowStep | undefined {
  for (const step of jobSteps) {
    if (stepUsesDockerOrDepotBuildPushAction(step)) {
      if (actionStepPushesImage(step) && !actionStepUsesZstd(step)) {
        return step;
      }
      continue;
    }

    if (shellStepBuildsAndPushesWithBuildKit(step) && !shellStepUsesZstd(step)) {
      return step;
    }
  }

  return undefined;
}

export const preferZstdCompressionForPushedDockerImagesRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const step = findMissingZstdStep(job.steps);
      if (!step) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, step.runNode ?? step.usesNode ?? step.node, {
          message: `Job "${job.id}" pushes a BuildKit-built Docker image without requesting zstd layer compression.`,
          why: "BuildKit defaults to gzip layer compression. zstd can reduce push/pull and decompression time for registries and runtimes that support OCI zstd layers, especially for images pulled often by CI or Kubernetes.",
          suggestion:
            "For pushed BuildKit images, set output options such as `compression=zstd,oci-mediatypes=true` and verify your registry and runtime support OCI zstd-compressed layers.",
          measurementHint:
            "Compare image push time, pull time, startup latency, and registry compatibility before and after enabling zstd compression.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and add \`compression=zstd,oci-mediatypes=true\` to the Docker build output if the target registry and runtime support zstd-compressed OCI layers.`,
          score: 69,
        }),
      );
    }
    return findings;
  },
};
