import type { Node } from "../../yaml.ts";
import type { CIDocument } from "./any-step.ts";
import { collectCommandEntries } from "./any-step.ts";
import { hasShellInputDocument, shellCommands } from "./command-patterns.ts";
import { getScalarValue } from "../../workflow.ts";
import { jobIsStaticallyDisabled } from "./workflow-jobs.ts";

export interface DockerImageRun {
  image: string;
  node: Node | undefined;
  jobName: string;
  words: string[];
}

const valueOptions = new Set([
  "--add-host",
  "--cpus",
  "--cpuset-cpus",
  "--device",
  "--entrypoint",
  "--env",
  "--env-file",
  "--expose",
  "--gpus",
  "--health-cmd",
  "--health-interval",
  "--health-retries",
  "--health-start-interval",
  "--health-start-period",
  "--health-timeout",
  "--hostname",
  "--ipc",
  "--label",
  "--log-driver",
  "--log-opt",
  "--memory",
  "--mount",
  "--name",
  "--network",
  "--pid",
  "--platform",
  "--publish",
  "--pull",
  "--restart",
  "--runtime",
  "--security-opt",
  "--shm-size",
  "--stop-signal",
  "--stop-timeout",
  "--tmpfs",
  "--ulimit",
  "--user",
  "--uts",
  "--volume",
  "--workdir",
  "-e",
  "-h",
  "-m",
  "-p",
  "-u",
  "-v",
  "-w",
]);

const flagOptions = new Set([
  "--detach",
  "--init",
  "--interactive",
  "--no-healthcheck",
  "--privileged",
  "--read-only",
  "--rm",
  "--tty",
  "-d",
  "-i",
  "-t",
]);

function activeCommandEntries(doc: CIDocument) {
  const entries = collectCommandEntries(doc);
  if (doc.kind !== "github-actions") {
    return entries;
  }
  const activeNodes = new Set(
    doc.jobs.flatMap((job) =>
      jobIsStaticallyDisabled(job)
        ? []
        : job.steps
            .filter(
              (step) =>
                getScalarValue(step.node, "if") !== false &&
                step.if?.trim() !== "false" &&
                step.if?.trim() !== "${{ false }}",
            )
            .map((step) => step.runNode),
    ),
  );
  return entries.filter((entry) => entry.node !== undefined && activeNodes.has(entry.node));
}

const commandWrappers = new Set(["command", "exec", "nohup", "sudo", "time"]);

function dockerRunImage(words: string[]): { image: string; words: string[] } | undefined {
  let start = 0;
  while (start < words.length && commandWrappers.has(words[start]!)) {
    start++;
  }
  while (/^[A-Za-z_]\w*=/.test(words[start] ?? "")) {
    start++;
  }
  const command = words.slice(start);
  if (command[0] !== "docker" || command[1] !== "run") {
    return undefined;
  }
  let index = 2;
  for (; index < command.length; index++) {
    const word = command[index]!;
    if (word === "--") {
      index++;
      break;
    }
    if (!word.startsWith("-")) {
      break;
    }
    if (word.includes("=")) {
      continue;
    }
    if (flagOptions.has(word)) {
      continue;
    }
    if (!valueOptions.has(word)) {
      // Unknown option: do not guess whether the next token is a value.
      return undefined;
    }
    index++;
  }
  const image = command[index];
  return image ? { image, words: command } : undefined;
}

/** Find `docker run <official image>` commands in any supported CI document. */
export function dockerImageRuns(doc: CIDocument, imagePattern: RegExp): DockerImageRun[] {
  const results: DockerImageRun[] = [];
  for (const entry of activeCommandEntries(doc)) {
    if (hasShellInputDocument(entry.text)) {
      continue;
    }
    for (const rawWords of shellCommands(entry.text)) {
      if (rawWords.some((word) => /[$`]/.test(word))) {
        continue;
      }
      const run = dockerRunImage(rawWords);
      if (run && imagePattern.test(run.image)) {
        results.push({
          image: run.image,
          node: entry.node,
          jobName: entry.jobName,
          words: run.words,
        });
      }
    }
  }
  return results;
}
