import type { CIDocument } from "./any-step.ts";
import { collectCommandEntries } from "./any-step.ts";
import { hasShellInputDocument, shellCommands } from "./command-patterns.ts";
import { getScalarValue } from "../../workflow.ts";
import { jobIsStaticallyDisabled } from "./workflow-jobs.ts";

const imagePattern =
  /^(?:docker\.io\/)?amazon\/dynamodb-local(?::[\w.-]+)?(?:@sha256:[a-fA-F0-9]{64})?$/;
const valueOptions = new Set([
  "--name",
  "--publish",
  "-p",
  "--network",
  "--workdir",
  "-w",
  "--cpus",
  "--memory",
  "-m",
  "--env",
  "-e",
]);

interface DynamoDbLocalRun {
  image: string;
  args: string[];
  disposable: boolean;
}

export function dynamodbLocalRuns(text: string): DynamoDbLocalRun[] {
  if (hasShellInputDocument(text)) {
    return [];
  }
  const runs: DynamoDbLocalRun[] = [];
  for (const rawWords of shellCommands(text)) {
    if (rawWords.some((word) => /[$`]/.test(word))) {
      continue;
    }
    const words = rawWords[0] === "sudo" ? rawWords.slice(1) : rawWords;
    if (words[0] !== "docker" || words[1] !== "run") {
      continue;
    }
    let disposable = false;
    let index = 2;
    for (; index < words.length; index++) {
      const word = words[index]!;
      if (!word.startsWith("-")) {
        break;
      }
      if (word === "--rm" || word === "--rm=true") {
        disposable = true;
      } else if (word === "-d" || word === "--detach" || word === "--init") {
        continue;
      } else {
        const option = word.split("=")[0]!;
        if (!valueOptions.has(option)) {
          break;
        }
        if (!word.includes("=")) {
          if (!words[index + 1] || words[index + 1]!.startsWith("-")) {
            break;
          }
          index++;
        }
      }
    }
    const image = words[index];
    if (image && imagePattern.test(image)) {
      runs.push({ image, args: words.slice(index + 1), disposable });
    }
  }
  return runs;
}

export function dynamodbLocalCommandEntries(doc: CIDocument) {
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

export function isDisposableDiskBackedSharedRun(run: DynamoDbLocalRun): boolean {
  if (!run.disposable || !run.args.includes("-sharedDb")) {
    return false;
  }
  let hasJar = false;
  for (let index = 0; index < run.args.length; index++) {
    const arg = run.args[index]!;
    if (arg === "-sharedDb" || arg === "-disableTelemetry") {
      continue;
    }
    if (arg === "-jar" && run.args[index + 1] === "DynamoDBLocal.jar") {
      hasJar = true;
      index++;
    } else if (arg === "-port" && /^\d+$/.test(run.args[index + 1] ?? "")) {
      index++;
    } else {
      // Unknown flags, explicit persistence, in-memory, and artificial-delay
      // configurations are deliberately not candidates for a mode change.
      return false;
    }
  }
  return hasJar;
}
