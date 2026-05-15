/* oxlint-disable typescript/prefer-for-of */
import type { Node } from "yaml";
import type { WorkflowDocument, WorkflowStep } from "../../workflow.ts";
import type { PipelineDocument, PipelineStep } from "../../buildkite-workflow.ts";
import type { CircleCiDocument } from "../../circleci-workflow.ts";
import type { GitlabCiDocument } from "../../gitlab-ci-workflow.ts";
import type { AnyWorkflowDocument } from "../../ci-types.ts";

export type AnyStep = WorkflowStep | PipelineStep;

type CIDocumentNormalizer<D> = (doc: D) => CommandEntry[];

export type CIDocument = AnyWorkflowDocument;

const MAX_RUN_PREVIEW = 40;
const ansiRe = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, "g");

function stripAnsi(text: string): string {
  return text.replace(ansiRe, "");
}

export function stepDisplayName(step: { name?: string; run?: string; uses?: string }): string {
  if (step.name) {
    return stripAnsi(step.name);
  }
  if (step.run) {
    const text = stripAnsi(step.run.replace(/\s+/g, " ").trim());
    if (text.length <= MAX_RUN_PREVIEW) {
      return `\`${text}\``;
    }
    return `\`${text.slice(0, MAX_RUN_PREVIEW - 3)}...\``;
  }
  if (step.uses) {
    return stripAnsi(step.uses);
  }
  return "(unnamed)";
}

function isWorkflowStep(step: AnyStep): step is WorkflowStep {
  return "run" in step || "uses" in step;
}

function isPipelineStep(step: AnyStep): step is PipelineStep {
  return "command" in step || "commands" in step;
}

export function getStepCommandText(step: AnyStep): string {
  if (isWorkflowStep(step)) {
    return `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""}`.toLowerCase();
  }
  if (isPipelineStep(step)) {
    const commands = Array.isArray(step.commands) ? step.commands.join(" ") : "";
    return `${step.label ?? ""} ${step.command ?? ""} ${commands}`.toLowerCase();
  }
  return "";
}

export interface CommandEntry {
  text: string;
  node: Node | undefined;
  jobName: string;
  stepName: string;
  workingDirectory?: string;
}

const commandEntryCollectors: Record<string, CIDocumentNormalizer<CIDocument>> = {
  circleci: (doc: CIDocument) => {
    const d = doc as CircleCiDocument;
    const entries: CommandEntry[] = [];
    for (const job of d.jobs) {
      for (const step of job.steps) {
        if (step.command) {
          entries.push({
            text: step.command,
            node: step.commandNode as unknown as Node | undefined,
            jobName: job.name,
            stepName: step.name ?? "(unnamed)",
            workingDirectory: step.workingDirectory,
          });
        }
      }
    }
    return entries;
  },
  "gitlab-ci": (doc: CIDocument) => {
    const d = doc as GitlabCiDocument;
    const entries: CommandEntry[] = [];
    for (const job of d.jobs) {
      const scriptLines = job.script ?? [];
      for (let i = 0; i < scriptLines.length; i++) {
        entries.push({
          text: scriptLines[i]!,
          node: undefined,
          jobName: job.name,
          stepName: job.name,
          workingDirectory: undefined,
        });
      }
    }
    return entries;
  },
  buildkite: (doc: CIDocument) => {
    const d = doc as PipelineDocument;
    const entries: CommandEntry[] = [];
    for (const step of d.steps) {
      if (step.isWait || step.isBlock || step.isTrigger || step.isGroup) {
        continue;
      }
      const commands = step.commands ?? (step.command ? [step.command] : []);
      for (const cmd of commands) {
        entries.push({
          text: cmd,
          node: step.commandNode as unknown as Node | undefined,
          jobName: step.label ?? step.key ?? "(unnamed)",
          stepName: step.label ?? step.key ?? "(unnamed)",
          workingDirectory: undefined,
        });
      }
    }
    return entries;
  },
  "github-actions": (doc: CIDocument) => {
    const d = doc as WorkflowDocument;
    const entries: CommandEntry[] = [];
    for (const job of d.jobs) {
      for (const step of job.steps) {
        const run = step.run;
        if (run !== undefined) {
          entries.push({
            text: run,
            node: step.runNode as unknown as Node | undefined,
            jobName: job.id,
            stepName: step.name ?? job.id,
            workingDirectory: step.workingDirectory,
          });
        }
      }
    }
    return entries;
  },
};

const entryCache = new WeakMap<CIDocument, CommandEntry[]>();

export function collectCommandEntries(doc: CIDocument): CommandEntry[] {
  const cached = entryCache.get(doc);
  if (cached) {
    return cached;
  }

  const normalizer = commandEntryCollectors[doc.kind];
  const entries = normalizer ? normalizer(doc) : [];
  entryCache.set(doc, entries);
  return entries;
}
