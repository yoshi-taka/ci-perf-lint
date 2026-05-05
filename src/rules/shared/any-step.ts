import type { Node } from "yaml";
import type { WorkflowDocument, WorkflowStep } from "../../workflow.ts";
import type { PipelineDocument, PipelineStep } from "../../buildkite-workflow.ts";
import type { CircleCiDocument } from "../../circleci-workflow.ts";
import type { GitlabCiDocument } from "../../gitlab-ci-workflow.ts";

export type AnyStep = WorkflowStep | PipelineStep;
export type AnyDocument = WorkflowDocument | PipelineDocument;

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

export function getDocumentSteps(doc: AnyDocument): AnyStep[] {
  if ("jobs" in doc) {
    const wfDoc = doc;
    const steps: AnyStep[] = [];
    for (const job of wfDoc.jobs) {
      for (const step of job.steps) {
        steps.push(step);
      }
    }
    return steps;
  }
  return doc.steps;
}

interface CommandEntry {
  text: string;
  node: Node | undefined;
  jobName: string;
  stepName: string;
}

function isCircleCiDoc(doc: unknown): doc is CircleCiDocument {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "kind" in doc &&
    (doc as Record<string, unknown>).kind === "circleci"
  );
}

function isGitlabCiDoc(doc: unknown): doc is GitlabCiDocument {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "kind" in doc &&
    (doc as Record<string, unknown>).kind === "gitlab-ci"
  );
}

function isPipelineDoc(doc: unknown): doc is PipelineDocument {
  return typeof doc === "object" && doc !== null && "steps" in doc && !("jobs" in doc);
}

export function collectCommandEntries(
  doc: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
): CommandEntry[] {
  if (isCircleCiDoc(doc)) {
    const entries: CommandEntry[] = [];
    for (const job of doc.jobs) {
      for (const step of job.steps) {
        if (step.command) {
          entries.push({
            text: step.command,
            node: step.commandNode ?? step.node,
            jobName: job.name,
            stepName: step.name ?? "unnamed",
          });
        }
      }
    }
    return entries;
  }
  if (isGitlabCiDoc(doc)) {
    const entries: CommandEntry[] = [];
    for (const job of doc.jobs) {
      for (const cmd of job.script ?? []) {
        entries.push({
          text: cmd,
          node: job.scriptNode ?? job.node,
          jobName: job.name,
          stepName: "script",
        });
      }
    }
    return entries;
  }
  if (isPipelineDoc(doc)) {
    const entries: CommandEntry[] = [];
    for (const step of doc.steps) {
      if (step.isWait || step.isBlock || step.isTrigger || step.isGroup) {
        continue;
      }
      const texts: string[] = [];
      if (step.command) {
        texts.push(step.command);
      }
      if (Array.isArray(step.commands)) {
        texts.push(...step.commands);
      }
      for (const text of texts) {
        entries.push({
          text,
          node: step.commandNode ?? step.node,
          jobName: step.label ?? "unnamed",
          stepName: step.label ?? "unnamed",
        });
      }
    }
    return entries;
  }
  const entries: CommandEntry[] = [];
  for (const job of doc.jobs) {
    for (const step of job.steps) {
      if (step.run) {
        entries.push({
          text: step.run,
          node: step.runNode ?? step.node,
          jobName: job.id,
          stepName: step.name ?? "unnamed",
        });
      }
    }
  }
  return entries;
}
