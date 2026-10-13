import type { WorkflowStep } from "../../workflow.ts";
import { getStepFacts } from "./step-facts.ts";
import { parseBootstrapInvocation } from "./command-patterns.ts";

export type { DependencyFamily, SetupActionKind } from "./tools-text.ts";
export {
  usesLanguageInstall,
  detectInstallCommandFromText,
  detectLintToolFromText,
  detectBuildToolFromText,
  detectRedundantBootstrapToolFromText,
} from "./tools-text.ts";

export function detectInstallCommand(step: WorkflowStep): string | undefined {
  return getStepFacts(step).installCommand;
}

export function detectLintTool(step: WorkflowStep): string | undefined {
  return getStepFacts(step).lintTool;
}

export function detectBuildTool(step: WorkflowStep): string | undefined {
  return getStepFacts(step).buildTool;
}

export function detectPythonTool(step: WorkflowStep): string | undefined {
  return getStepFacts(step).pythonTool;
}

export function detectRedundantBootstrapTool(step: WorkflowStep): string | undefined {
  return getStepFacts(step).redundantBootstrapTool;
}

export function normalizeRunCommand(run: string | undefined): string {
  if (!run) {
    return "";
  }
  return parseBootstrapInvocation(run)?.command ?? run.trim();
}
