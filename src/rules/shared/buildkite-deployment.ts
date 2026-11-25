import type { PipelineDocument, PipelineStep } from "../../buildkite-workflow.ts";
import { buildkitePluginBaseNames } from "./buildkite-plugins.ts";
import { shellNonDisplayInvocations } from "./shell-invocations.ts";
import { invocationWorkName } from "./tooling-command-evidence.ts";
import { invocationOperands, invocationOptions } from "./tool-command-evidence.ts";
import { dockerBuildFlag } from "./docker-build-commands.ts";
import { unwrapBuildkiteCommand } from "./buildkite-command-wrappers.ts";

const deploymentName =
  /(?:\b|_)(?:deploy|kubectl|helm|argocd|publish|release|testflight|app[ _-]?store)(?:\b|_)/i;
const distributionLabel = /\b(?:upload|sync)\b.*\bs3\b|\b(?:purge|invalidate)\b.*\bcloudfront\b/i;
const mobileLane =
  /(?:\b|_)(?:upload|beta|pilot|deliver|deploy|publish|release|testflight|app[ _-]?store)(?:\b|_)/i;

function fastlanePublishes(words: string[]): boolean {
  const start =
    words[0] === "fastlane"
      ? 0
      : words[0] === "bundle" && words[1] === "exec" && words[2] === "fastlane"
        ? 2
        : -1;
  if (start < 0) {
    return false;
  }
  const invocation = words.slice(start);
  if (
    invocationOptions(invocation, ["--env"]).some(({ name }) =>
      ["--help", "-h", "--version"].includes(name),
    )
  ) {
    return false;
  }
  const operands = invocationOperands(invocation, ["--env"]);
  if (["action", "lanes", "list"].includes(operands[0] ?? "")) {
    return false;
  }
  const laneIndex = ["ios", "android", "mac", "run"].includes(operands[0] ?? "") ? 1 : 0;
  const lane = operands[laneIndex];
  if (
    ["pilot", "deliver"].includes(lane ?? "") &&
    ["list", "download", "init", "generate_metadata", "validate"].includes(
      operands[laneIndex + 1] ?? "",
    )
  ) {
    return false;
  }
  return mobileLane.test(lane ?? "");
}

function otherBuilderPublishes(words: string[]): boolean {
  const tool = words[0] ?? "";
  if (
    !["depot", "drivah", "podman", "buildah", "buildctl", "nerdctl", "pack", "earthly"].includes(
      tool,
    ) &&
    !/(?:^|[-_])builder(?:$|[-_])/.test(tool)
  ) {
    return false;
  }
  if (!["build", "bud", "bake"].includes(words[1] ?? "")) {
    return false;
  }
  const args = words.slice(2);
  return !dockerBuildFlag(args, "--help") && dockerBuildFlag(args, "--push");
}

const awsValueOptions = [
  "--region",
  "--profile",
  "--endpoint-url",
  "--output",
  "--query",
  "--ca-bundle",
  "--cli-read-timeout",
  "--cli-connect-timeout",
  "--color",
  "--exclude",
  "--include",
  "--acl",
  "--cache-control",
  "--content-type",
  "--content-encoding",
  "--content-disposition",
  "--content-language",
  "--expires",
  "--metadata",
  "--metadata-directive",
  "--copy-props",
  "--storage-class",
  "--sse",
  "--sse-kms-key-id",
  "--sse-c",
  "--sse-c-key",
  "--sse-c-copy-source",
  "--sse-c-copy-source-key",
  "--website-redirect",
  "--request-payer",
  "--expected-size",
  "--checksum-mode",
  "--checksum-algorithm",
  "--distribution-id",
  "--paths",
];
const awsFlags = new Set([
  "--debug",
  "--no-verify-ssl",
  "--no-paginate",
  "--no-sign-request",
  "--no-cli-pager",
  "--cli-auto-prompt",
  "--no-cli-auto-prompt",
  "--quiet",
  "--only-show-errors",
  "--recursive",
  "--delete",
  "--follow-symlinks",
  "--no-follow-symlinks",
  "--no-guess-mime-type",
  "--exact-timestamps",
  "--size-only",
  "--ignore-glacier-warnings",
  "--force-glacier-transfer",
]);

function awsPublishes(words: string[]): boolean {
  const options = invocationOptions(words, awsValueOptions);
  // Unknown/variadic options cannot safely identify source and destination.
  if (options.some(({ name }) => !awsFlags.has(name) && !awsValueOptions.includes(name))) {
    return false;
  }
  const [service, action, source, destination] = invocationOperands(words, awsValueOptions);
  if (service === "cloudfront" && action === "create-invalidation") {
    return true;
  }
  return (
    service === "s3" &&
    ["sync", "cp"].includes(action ?? "") &&
    Boolean(source) &&
    (destination ?? "").startsWith("s3://")
  );
}

function dockerPublishes(words: string[]): boolean {
  if (words.includes("--help")) {
    return false;
  }
  const [, action, subcommand] = words;
  if (action === "push" || (action === "image" && subcommand === "push")) {
    return true;
  }
  const args =
    action === "build"
      ? words.slice(2)
      : action === "buildx" && subcommand === "build"
        ? words.slice(3)
        : undefined;
  return args !== undefined && dockerBuildFlag(args, "--push");
}

/** Metadata can describe deployment work hidden behind an opaque script. */
function hasDeploymentMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === "deploy";
}

export function buildkiteStepDeploys(step: PipelineStep): boolean {
  if (
    deploymentName.test(step.label ?? "") ||
    distributionLabel.test(step.label ?? "") ||
    (/\bfastlane\b/i.test(step.label ?? "") && mobileLane.test(step.label ?? ""))
  ) {
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
  return buildkiteTextDeploys(source);
}

export function buildkiteTextDeploys(source: string): boolean {
  return [...shellNonDisplayInvocations(source), ...shellNonDisplayInvocations(source, true)].some(
    (words) => {
      const command = unwrapBuildkiteCommand(words);
      if (!command) {
        return false;
      }
      words = command;
      if (
        deploymentName.test(invocationWorkName(words)) ||
        (["make", "just", "task"].includes(words[0] ?? "") && deploymentName.test(words[1] ?? ""))
      ) {
        return true;
      }
      if (fastlanePublishes(words) || otherBuilderPublishes(words)) {
        return true;
      }
      if (words[0] === "docker") {
        return dockerPublishes(words);
      }
      // Uploads change a remote environment; downloading cached inputs does not.
      return words[0] === "aws" && awsPublishes(words);
    },
  );
}

export function buildkitePipelineDeploys(pipeline: PipelineDocument): boolean {
  return (
    pipeline.steps.some(buildkiteStepDeploys) ||
    Object.values(pipeline.parsed ?? {}).some(hasDeploymentMetadata)
  );
}
