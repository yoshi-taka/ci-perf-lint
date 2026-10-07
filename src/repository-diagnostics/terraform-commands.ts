import path from "node:path";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { shellCommandSegments, staticShellWords } from "../rules/shared/command-patterns.ts";
import {
  workflowStepEnv,
  workflowWorkingDirectory,
} from "../rules/shared/workflow-command-context.ts";

export interface TerraformCommand {
  workflow: WorkflowDocument;
  job: WorkflowJob;
  step: WorkflowStep;
  directory: string;
  verb: string;
  args: string[];
  env: Record<string, unknown>;
}

export function collectTerraformCommands(
  workflows: readonly WorkflowDocument[],
): TerraformCommand[] {
  const commands: TerraformCommand[] = [];
  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        let directory: string | undefined = workflowWorkingDirectory(workflow, job, step);
        const env = workflowStepEnv(workflow, job, step);
        for (const segment of shellCommandSegments(step.run ?? "")) {
          const words = staticShellWords(segment);
          if (!words) {
            directory = undefined;
            continue;
          }
          if (words[0] === "cd") {
            directory =
              directory && words.length === 2
                ? path.posix.normalize(path.posix.join(directory, words[1]!))
                : undefined;
            continue;
          }
          if (["pushd", "popd", "source", "."].includes(words[0] ?? "")) {
            directory = undefined;
            continue;
          }
          const commandEnv = { ...env };
          while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) {
            const assignment = words.shift()!;
            const index = assignment.indexOf("=");
            commandEnv[assignment.slice(0, index)] = assignment.slice(index + 1);
          }
          if (words[0] !== "terraform" || !directory || directory.includes("${{")) {
            continue;
          }
          let index = 1;
          let target = directory;
          if (words[index]?.startsWith("-chdir=")) {
            target = path.posix.join(directory, words[index++]!.slice(7));
          } else if (words[index] === "-chdir" && words[index + 1]) {
            target = path.posix.join(directory, words[index + 1]!);
            index += 2;
          }
          target = path.posix.normalize(target);
          if (path.posix.isAbsolute(target) || target === ".." || target.startsWith("../")) {
            continue;
          }
          const verb = words[index++];
          if (!verb) {
            continue;
          }
          commands.push({
            workflow,
            job,
            step,
            directory: target,
            verb,
            args: words.slice(index),
            env: commandEnv,
          });
        }
      }
    }
  }
  return commands;
}
