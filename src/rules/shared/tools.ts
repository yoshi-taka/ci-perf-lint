import type { WorkflowStep } from "../../workflow.ts";
import { getStepFacts } from "./step-facts.ts";

export type { DependencyFamily, SetupActionKind } from "./tools-text.ts";
export {
  usesLanguageInstall,
  detectInstallCommandFromText,
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
  return run
    .trim()
    .replace(
      /^(npx|pnpx|pnpm\s+dlx|bunx|yarn\s+dlx|uvx|uv\s+tool\s+run)(?:\s+(?:--yes|--no|--package|-p)\s+\S+)*\s+/i,
      "",
    )
    .trim();
}
