import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  buildkitBuildArguments,
  dockerBuildFlag,
  dockerBuildOptionValues,
} from "./shared/docker-build-commands.ts";

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

function shellStepNeedsZstd(step: WorkflowStep): boolean {
  return buildkitBuildArguments(step.run ?? "").some((args) => {
    const outputs = dockerBuildOptionValues(args, "--output").map(
      (output) =>
        new Map(
          output.split(",").map((entry) => {
            const equals = entry.indexOf("=");
            return [entry.slice(0, equals).trim(), entry.slice(equals + 1).trim()] as const;
          }),
        ),
    );
    const pushedOutputs = outputs.filter(
      (output) =>
        output.get("type") === "registry" ||
        (output.get("type") === "image" && output.get("push") === "true"),
    );
    if (!dockerBuildFlag(args, "--push") && pushedOutputs.length === 0) {
      return false;
    }
    const selected = pushedOutputs.length
      ? pushedOutputs
      : outputs.filter((output) => !output.has("type") || output.get("type") === "image");
    return (
      selected.length === 0 ||
      selected.some(
        (output) => output.get("compression") !== "zstd" || output.get("oci-mediatypes") !== "true",
      )
    );
  });
}

function findMissingZstdStep(jobSteps: WorkflowStep[]): WorkflowStep | undefined {
  for (const step of jobSteps) {
    if (stepUsesDockerOrDepotBuildPushAction(step)) {
      if (actionStepPushesImage(step) && !actionStepUsesZstd(step)) {
        return step;
      }
      continue;
    }

    if (shellStepNeedsZstd(step)) {
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
