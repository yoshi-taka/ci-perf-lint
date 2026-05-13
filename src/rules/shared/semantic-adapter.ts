import type { Node } from "yaml";
import type { CIDocument, CommandEntry } from "./any-step.ts";
import { collectCommandEntries } from "./any-step.ts";
import {
  detectInstallCommandFromText,
  detectLintToolFromText,
  detectBuildToolFromText,
} from "./tools.ts";

type Provider = "github-actions" | "buildkite" | "gitlab-ci" | "circleci" | "universal";

export type CommandType = "install" | "lint" | "test" | "build" | "setup" | "other";

export interface SemanticStep {
  text: string;
  node: Node | undefined;
  jobName: string;
  stepName: string;
  commandType: CommandType;
  workingDirectory?: string;
}

interface ProviderAdapter<D extends CIDocument> {
  readonly provider: Provider;
  extractSteps(doc: D): SemanticStep[];
}

function classifyCommandType(stepName: string, text: string): CommandType {
  const install = detectInstallCommandFromText(text);
  if (install) {
    return "install";
  }

  const combined = `${stepName} ${text}`.toLowerCase();
  const lint = detectLintToolFromText(stepName, combined);
  if (lint) {
    return "lint";
  }

  const build = detectBuildToolFromText(stepName, combined);
  if (build) {
    return "build";
  }

  const lower = text.toLowerCase();
  if (/\b(test|spec|it|describe|jest|vitest|pytest|npx\s+test)\b/.test(lower)) {
    return "test";
  }

  if (/\b(setup|configure|init|bootstrap)\b/.test(lower)) {
    return "setup";
  }

  return "other";
}

function commandEntryToSemanticStep(entry: CommandEntry): SemanticStep {
  return {
    text: entry.text,
    node: entry.node,
    jobName: entry.jobName,
    stepName: entry.stepName,
    commandType: classifyCommandType(entry.stepName, entry.text),
    workingDirectory: entry.workingDirectory,
  };
}

const universalAdapter: ProviderAdapter<CIDocument> = {
  provider: "universal",
  extractSteps(doc: CIDocument): SemanticStep[] {
    const entries = collectCommandEntries(doc);
    return entries.map(commandEntryToSemanticStep);
  },
};

export function extractSemanticSteps(doc: CIDocument): SemanticStep[] {
  return universalAdapter.extractSteps(doc);
}

export function groupStepsByJob(steps: SemanticStep[]): Map<string, SemanticStep[]> {
  const groups = new Map<string, SemanticStep[]>();
  for (const step of steps) {
    const group = groups.get(step.jobName) ?? [];
    group.push(step);
    groups.set(step.jobName, group);
  }
  return groups;
}

function countCommandTypes(steps: SemanticStep[]): Record<CommandType, number> {
  const counts: Record<CommandType, number> = {
    install: 0,
    lint: 0,
    test: 0,
    build: 0,
    setup: 0,
    other: 0,
  };
  for (const step of steps) {
    counts[step.commandType]++;
  }
  return counts;
}
