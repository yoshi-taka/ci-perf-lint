import type { PipelineDocument, PipelineStep } from "../../buildkite-workflow.ts";
import { buildkitePluginBaseNames } from "./buildkite-plugins.ts";
import { shellNonDisplayInvocations } from "./shell-invocations.ts";
import { invocationWorkName } from "./tooling-command-evidence.ts";

const deploymentName = /\b(deploy|kubectl|helm|argocd|publish|release)\b/i;
const distributionLabel = /\b(?:upload|sync)\b.*\bs3\b|\b(?:purge|invalidate)\b.*\bcloudfront\b/i;

/** Metadata can describe deployment work hidden behind an opaque script. */
function hasDeploymentMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === "deploy";
}

export function buildkiteStepDeploys(step: PipelineStep): boolean {
  if (deploymentName.test(step.label ?? "") || distributionLabel.test(step.label ?? "")) {
    return true;
  }
  if (buildkitePluginBaseNames(step).some((name) => /(?:^|-)deploy$/.test(name))) {
    return true;
  }
  const raw = step.node.toJSON();
  if (raw && typeof raw === "object" && Object.values(raw).some(hasDeploymentMetadata)) {
    return true;
  }
  const source = [step.command ?? "", ...(step.commands ?? [])].join("\n");
  return [...shellNonDisplayInvocations(source), ...shellNonDisplayInvocations(source, true)].some(
    (words) => {
      if (
        deploymentName.test(invocationWorkName(words)) ||
        (["make", "just", "task"].includes(words[0] ?? "") && deploymentName.test(words[1] ?? ""))
      ) {
        return true;
      }
      if (words[0] !== "aws") {
        return false;
      }
      if (words[1] === "cloudfront" && words.includes("create-invalidation")) {
        return true;
      }
      // Uploads change a remote environment; downloading cached inputs does not.
      return (
        words[1] === "s3" &&
        ["sync", "cp"].includes(words[2] ?? "") &&
        (words[4] ?? "").startsWith("s3://")
      );
    },
  );
}

export function buildkitePipelineDeploys(pipeline: PipelineDocument): boolean {
  return (
    pipeline.steps.some(buildkiteStepDeploys) ||
    Object.values(pipeline.parsed ?? {}).some(hasDeploymentMetadata)
  );
}
