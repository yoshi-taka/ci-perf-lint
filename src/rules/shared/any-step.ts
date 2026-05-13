import type { Node } from "yaml";
import type { WorkflowDocument, WorkflowStep } from "../../workflow.ts";
import type { PipelineDocument, PipelineStep } from "../../buildkite-workflow.ts";
import type { CircleCiDocument } from "../../circleci-workflow.ts";
import type { GitlabCiDocument } from "../../gitlab-ci-workflow.ts";

export type AnyStep = WorkflowStep | PipelineStep;

type CIDocumentNormalizer<D> = (doc: D) => CommandEntry[];

export type CIDocument = WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument;

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

function buildCircleCiEntries(doc: CircleCiDocument): CommandEntry[] {
  const entries: CommandEntry[] = [];
  for (const job of doc.jobs) {
    for (const step of job.steps) {
      if (step.command) {
        entries.push({
          text: step.command,
          node: step.commandNode ?? step.node,
          jobName: job.name,
          stepName: stepDisplayName(step),
        });
      }
    }
  }
  return entries;
}

function buildGitlabCiEntries(doc: GitlabCiDocument): CommandEntry[] {
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

function buildBuildkiteEntries(doc: PipelineDocument): CommandEntry[] {
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

function buildGitHubActionsEntries(doc: WorkflowDocument): CommandEntry[] {
  const entries: CommandEntry[] = [];
  for (const job of doc.jobs) {
    for (const step of job.steps) {
      if (step.run) {
        entries.push({
          text: step.run,
          node: step.runNode ?? step.node,
          jobName: job.id,
          stepName: stepDisplayName(step),
          workingDirectory: step.workingDirectory,
        });
      }
    }
  }
  return entries;
}

/**
 * Normalize a CI document from any supported provider into a flat CommandEntry[].
 *
 * Invariants:
 * - Traversal order is deterministic (provider order: CircleCI → GitLab → Buildkite → GH Actions)
 * - Same command sequence across providers produces the same CommandEntry[] text values
 * - Noop/empty steps are excluded
 * - Multiple commands within one step are expanded in declaration order
 */
const normalizeCiDocument: CIDocumentNormalizer<CIDocument> = (doc) => {
  if (isCircleCiDoc(doc)) {
    return buildCircleCiEntries(doc);
  }
  if (isGitlabCiDoc(doc)) {
    return buildGitlabCiEntries(doc);
  }
  if (isPipelineDoc(doc)) {
    return buildBuildkiteEntries(doc);
  }
  return buildGitHubActionsEntries(doc);
};

const commandEntriesCache = new WeakMap<CIDocument, CommandEntry[]>();

export function collectCommandEntries(doc: CIDocument): CommandEntry[] {
  const cached = commandEntriesCache.get(doc);
  if (cached) {
    return cached;
  }
  const entries = normalizeCiDocument(doc);
  commandEntriesCache.set(doc, entries);
  return entries;
}
