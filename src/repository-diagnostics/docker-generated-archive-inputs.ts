import path from "node:path";
import type { WorkflowDocument } from "../workflow.ts";
import type { DockerBuildTarget } from "./docker-build-targets.ts";
import { workflowWorkingDirectory } from "../rules/shared/workflow-command-context.ts";
import { shellCommands } from "./docker-package-cache-helpers.ts";
import { directCommand } from "./docker-image-metadata-helpers.ts";
import { commandOption } from "./docker-package-cache-paths.ts";

function literalPath(value: string | undefined): value is string {
  return !!value && !/[$`{}\s]|:\/\//.test(value);
}

function generatedByRun(run: string, directory: string, result: Set<string>): void {
  const packDirectories = new Set<string>();
  const commands = shellCommands(run);
  if (
    commands.some((tokens) =>
      /^(?:cd|pushd|popd|alias)$/.test(
        directCommand(tokens[0] === "if" ? tokens.slice(1) : tokens).name,
      ),
    ) ||
    /^\s*(?:function\b|\w+\s*\(\))/m.test(run)
  ) {
    result.clear();
    return;
  }
  let depth = 0;
  for (const line of run.split(/\r?\n/)) {
    const trimmed = line.trim();
    const firstTokens = shellCommands(trimmed)[0] ?? [];
    const pack = directCommand(firstTokens[0] === "if" ? firstTokens.slice(1) : firstTokens);
    if (pack.name === "npm" && pack.args[0] === "pack" && !pack.args.includes("--dry-run")) {
      const destination = commandOption(pack.args, "--pack-destination");
      if (literalPath(destination)) {
        packDirectories.add(path.resolve(directory, destination));
      }
    }
    if (/^(?:done|fi)(?:\s|;|$)/.test(trimmed)) {
      depth = Math.max(0, depth - 1);
    }
    if (/^(?:for|while|until|if)\s/.test(trimmed)) {
      depth++;
      result.clear();
      continue;
    }
    if (depth || !trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (/^(?:exit|return)(?:\s|$)/.test(trimmed)) {
      return;
    }
    if (/[|`]|\$\(|\b(?:then|else|case|function)\b/.test(trimmed)) {
      continue;
    }
    for (const tokens of shellCommands(trimmed)) {
      const command = directCommand(tokens);
      if (
        command.name === "npm" &&
        command.args[0] === "pack" &&
        !command.args.includes("--dry-run")
      ) {
        const destination = commandOption(command.args, "--pack-destination");
        if (literalPath(destination)) {
          packDirectories.add(path.resolve(directory, destination));
        }
      }
      if (command.name === "mv" && command.args.length === 2) {
        const [input, output] = command.args;
        if (
          input?.endsWith("/*.tgz") &&
          literalPath(output) &&
          output.endsWith(".tgz") &&
          packDirectories.has(path.resolve(directory, input.slice(0, -6)))
        ) {
          result.add(path.resolve(directory, output));
        }
      } else if (
        command.name === "tar" &&
        command.args.some((arg) => /^-?[czjJvf]*c[czjJvf]*f$/.test(arg))
      ) {
        const index = command.args.findIndex((arg) => /^-?[czjJvf]*c[czjJvf]*f$/.test(arg));
        const output = command.args[index + 1];
        if (literalPath(output)) {
          result.add(path.resolve(directory, output));
        }
      } else if (command.name === "zip") {
        if (command.args.some((arg) => arg.startsWith("-") && !/^-[rqj]+$/.test(arg))) {
          continue;
        }
        const output = command.args.find((arg) => !arg.startsWith("-"));
        if (literalPath(output) && output.endsWith(".zip")) {
          result.add(path.resolve(directory, output));
        }
      } else if (command.name === "rm" || command.name === "rmdir") {
        for (const arg of command.args.filter((value) => !value.startsWith("-"))) {
          if (!literalPath(arg)) {
            result.clear();
            break;
          }
          const removed = path.resolve(directory, arg);
          for (const file of result) {
            if (file === removed || file.startsWith(`${removed}${path.sep}`)) {
              result.delete(file);
            }
          }
        }
      }
    }
  }
}

export function collectGeneratedArchiveInputs(
  repoRoot: string,
  workflows: readonly WorkflowDocument[],
  target: DockerBuildTarget,
): Set<string> {
  const generated = new Set<string>();
  const workflow = workflows.find((candidate) => candidate.relativePath === target.workflow);
  const job = workflow?.jobs.find((candidate) => candidate.id === target.jobId);
  if (!workflow || !job || job.usesReusableWorkflow || job.hasIf) {
    return generated;
  }
  for (const step of job.steps) {
    const uses = step.uses?.toLowerCase() ?? "";
    // Stop before the first build: never attribute a later packaging step to an
    // earlier build of the same Dockerfile after target deduplication.
    if (
      /^(?:docker|depot|useblacksmith)\/build-push-action@/.test(uses) ||
      /\b(?:docker\s+(?:buildx\s+build|build|compose[^\n]*\bbuild)|depot\s+build)\b/.test(
        step.run ?? "",
      )
    ) {
      break;
    }
    if (uses.startsWith("actions/checkout@")) {
      generated.clear();
    }
    if (!step.run) {
      continue;
    }
    if (step.ifNode) {
      generated.clear();
      continue;
    }
    const workingDirectory = workflowWorkingDirectory(workflow, job, step);
    if (!literalPath(workingDirectory)) {
      generated.clear();
      continue;
    }
    generatedByRun(step.run, path.resolve(repoRoot, workingDirectory), generated);
  }
  return generated;
}
