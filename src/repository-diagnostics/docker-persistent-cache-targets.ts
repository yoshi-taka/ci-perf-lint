import path from "node:path";
import type { AnyWorkflowDocument } from "../ci-types.ts";
import { getScalarValue, type WorkflowDocument } from "../workflow.ts";
import {
  workflowStepEnv,
  workflowWorkingDirectory,
} from "../rules/shared/workflow-command-context.ts";
import type { DockerBuildTarget } from "./docker-build-targets.ts";
import { shellInvocations } from "../rules/shared/shell-invocations.ts";
import { shellExecutionTexts } from "../rules/shared/shell-execution-text.ts";
import { shellCommands } from "../rules/shared/command-patterns.ts";
import { declaredShellEnvironmentNames } from "../rules/shared/shell-environment-evidence.ts";

const valueOptions = new Set([
  "-f",
  "--file",
  "-t",
  "--tag",
  "-o",
  "--output",
  "--builder",
  "--platform",
  "-p",
  "--project",
  "--build-arg",
  "--secret",
  "--ssh",
  "--target",
  "--cache-from",
  "--cache-to",
  "--progress",
  "--label",
  "--network",
  "--provenance",
  "--sbom",
  "--build-context",
  "--attest",
  "--annotation",
  "--metadata-file",
  "--iidfile",
  "--no-cache-filter",
  "--ulimit",
  "--add-host",
  "--allow",
  "--call",
  "--shm-size",
  "--cgroup-parent",
  "--memory",
  "--memory-swap",
  "--cpuset-cpus",
  "--cpuset-mems",
  "--cpu-period",
  "--cpu-quota",
]);
const booleanOptions = new Set([
  "--push",
  "--load",
  "--no-cache",
  "--pull",
  "--quiet",
  "-q",
  "--check",
  "--rm",
  "--force-rm",
  "--compress",
  "--squash",
  "--disable-content-trust",
]);

function literalPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "-" &&
    !/[$`{}]|:\/\/|^git@|\s/.test(value)
  );
}

function target(
  repoRoot: string,
  workflow: string,
  jobId: string,
  options: {
    context: unknown;
    file?: unknown;
    persistence?: DockerBuildTarget["cacheMountPersistence"];
    directory?: string;
    targetStage?: string;
  },
): DockerBuildTarget | undefined {
  const { context, file, persistence, directory = "." } = options;
  if (
    !literalPath(context) ||
    !literalPath(directory) ||
    (file !== undefined && !literalPath(file))
  ) {
    return undefined;
  }
  const contextPath = path.resolve(repoRoot, directory, context);
  return {
    workflow,
    jobId,
    contextPath,
    dockerfilePath:
      typeof file === "string"
        ? path.resolve(repoRoot, directory, file)
        : path.join(contextPath, "Dockerfile"),
    cacheMountPersistence: persistence,
    targetStage: options.targetStage,
  };
}

interface BuildCommand {
  depot: boolean;
  buildx: boolean;
  context: string;
  file?: string;
  builder?: string;
  targetStage?: string;
}

export function parseDockerBuildCommand(words: string[]): BuildCommand | undefined {
  const [tool, action, subcommand] = words;
  const buildx = tool === "docker" && action === "buildx" && subcommand === "build";
  if (!buildx && !(["docker", "depot"].includes(tool ?? "") && action === "build")) {
    return undefined;
  }
  const args = words.slice(buildx ? 3 : 2);
  let context: string | undefined;
  let file: string | undefined;
  let builder: string | undefined;
  let targetStage: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if ([">", "<"].includes(arg)) {
      while (args[index + 1] === arg) {
        index++;
      }
      index++;
      continue;
    }
    if (arg === "--") {
      if (context !== undefined || index + 2 !== args.length) {
        return undefined;
      }
      context = args[index + 1];
      break;
    }
    if (arg.startsWith("--") && arg.includes("=")) {
      const [option, ...parts] = arg.split("=");
      if (!valueOptions.has(option!) && !booleanOptions.has(option!)) {
        return undefined;
      }
      if (option === "--file") {
        file = parts.join("=");
      }
      if (option === "--builder") {
        builder = parts.join("=");
      }
      if (option === "--target") {
        targetStage = parts.join("=");
      }
    } else if (valueOptions.has(arg)) {
      const value = args[++index];
      if (!value) {
        return undefined;
      }
      if (arg === "-f" || arg === "--file") {
        file = value;
      }
      if (arg === "--builder") {
        builder = value;
      }
      if (arg === "--target") {
        targetStage = value;
      }
    } else if (!booleanOptions.has(arg)) {
      if (arg.startsWith("-") || context !== undefined) {
        return undefined;
      }
      context = arg;
    }
  }
  return context
    ? {
        depot: tool === "depot",
        buildx,
        context,
        file,
        builder,
        targetStage,
      }
    : undefined;
}

function commands(text: string): string[][] {
  // Do not infer shell cwd, branches, or external scripts.
  if (
    shellExecutionTexts(text)
      .flatMap(shellCommands)
      .some(([tool]) => ["cd", "if", "for", "while", "case"].includes(tool ?? ""))
  ) {
    return [];
  }
  return shellInvocations(text);
}

function declaresBuilderOverride(text: string): boolean {
  const names = declaredShellEnvironmentNames(text);
  for (const words of shellExecutionTexts(text).flatMap(shellCommands)) {
    let index = words[0] === "sudo" ? 1 : 0;
    if (words[index] === "-n") {
      index++;
    }
    if (words[index] === "env") {
      index++;
    }
    while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
      names.add(words[index++]!.split("=", 1)[0]!);
    }
  }
  return ["BUILDX_BUILDER", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_BUILDKIT"].some((name) =>
    names.has(name),
  );
}

function hasBuilderOverride(env: Record<string, unknown>): boolean {
  return ["BUILDX_BUILDER", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_BUILDKIT"].some(
    (key) => env[key] !== undefined,
  );
}

function githubTargets(repoRoot: string, workflow: WorkflowDocument): DockerBuildTarget[] {
  const result: DockerBuildTarget[] = [];
  for (const job of workflow.jobs) {
    let blacksmith = false;
    for (const step of job.steps) {
      const condition = getScalarValue(step.node, "if");
      if (condition === false || condition === "false") {
        continue;
      }
      const uses = step.uses?.toLowerCase() ?? "";
      const env = workflowStepEnv(workflow, job, step);
      if (uses.startsWith("useblacksmith/setup-docker-builder@")) {
        blacksmith =
          !step.ifNode &&
          !hasBuilderOverride(env) &&
          (!uses.includes("@v2") || typeof step.with?.["cache-key"] === "string");
        continue;
      }
      if (uses.startsWith("docker/setup-buildx-action@")) {
        blacksmith = false;
      }
      const depot = uses.startsWith("depot/build-push-action@");
      if (depot || /^(?:docker|useblacksmith)\/build-push-action@/.test(uses)) {
        const fallback = step.with?.["buildx-fallback"];
        const persistence =
          depot && (fallback === undefined || fallback === false || fallback === "false")
            ? "depot"
            : !depot && blacksmith && !hasBuilderOverride(env) && step.with?.builder === undefined
              ? "blacksmith"
              : undefined;
        const buildTarget = target(repoRoot, workflow.relativePath, job.id, {
          context: step.with?.context ?? ".",
          file: step.with?.file,
          persistence,
          targetStage: typeof step.with?.target === "string" ? step.with.target : undefined,
        });
        if (buildTarget) {
          result.push(buildTarget);
        }
      }
      if (!step.run) {
        continue;
      }
      if (declaresBuilderOverride(step.run)) {
        blacksmith = false;
      }
      for (const command of commands(step.run)) {
        if (
          command[0] === "docker" &&
          ["buildx", "context"].includes(command[1] ?? "") &&
          ["create", "use", "rm"].includes(command[2] ?? "")
        ) {
          blacksmith = false;
        }
        const build = parseDockerBuildCommand(command);
        if (!build) {
          continue;
        }
        const persistence = build.depot
          ? "depot"
          : blacksmith && build.buildx && !build.builder && !hasBuilderOverride(env)
            ? "blacksmith"
            : undefined;
        const buildTarget = target(repoRoot, workflow.relativePath, job.id, {
          context: build.context,
          file: build.file,
          persistence,
          directory: workflowWorkingDirectory(workflow, job, step),
          targetStage: build.targetStage,
        });
        if (buildTarget) {
          result.push(buildTarget);
        }
      }
    }
  }
  return result;
}

function cachesDockerState(cache: unknown): boolean {
  if (cache === "/var/lib/docker") {
    return true;
  }
  if (Array.isArray(cache)) {
    return cache.includes("/var/lib/docker");
  }
  if (cache && typeof cache === "object" && "paths" in cache) {
    return cachesDockerState(cache.paths);
  }
  return false;
}

export function collectPersistentCacheDockerTargets(
  repoRoot: string,
  documents: readonly AnyWorkflowDocument[],
): DockerBuildTarget[] {
  const result: DockerBuildTarget[] = [];
  for (const doc of documents) {
    if (doc.kind === "github-actions") {
      result.push(...githubTargets(repoRoot, doc));
    } else if (doc.kind === "buildkite") {
      for (const [index, step] of doc.steps.entries()) {
        if (step.isWait || step.isBlock || step.isTrigger || step.isGroup) {
          continue;
        }
        const raw = step.node.toJSON() as Record<string, unknown>;
        const env = { ...doc.env, ...step.env };
        const localState =
          cachesDockerState(raw.cache ?? doc.parsed?.cache) &&
          !step.plugins?.length &&
          env.DOCKER_HOST === undefined &&
          env.DOCKER_CONTEXT === undefined &&
          env.DOCKER_BUILDKIT !== "0" &&
          env.DOCKER_BUILDKIT !== 0;
        const run = (step.commands ?? [step.command ?? ""]).join("\n");
        const overridesHost = declaresBuilderOverride(run);
        for (const command of commands(run)) {
          const build = parseDockerBuildCommand(command);
          if (!build) {
            continue;
          }
          const persistence = build.depot
            ? "depot"
            : localState &&
                !overridesHost &&
                (build.builder === "default" ||
                  (!build.builder && env.BUILDX_BUILDER === "default"))
              ? "buildkite-docker-state"
              : undefined;
          const buildTarget = target(repoRoot, doc.relativePath, step.key ?? `step-${index}`, {
            context: build.context,
            file: build.file,
            persistence,
            targetStage: build.targetStage,
          });
          if (buildTarget) {
            result.push(buildTarget);
          }
        }
      }
    }
  }
  return result;
}
