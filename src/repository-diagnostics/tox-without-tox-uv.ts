import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "tox-without-tox-uv",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/tox-without-tox-uv.md",
} satisfies RuleMeta;

const toxRunPattern = /(?:^|\s)(?:(?:python|python3)\s+-m\s+)?tox(?:\s|$)/i;
const pipInstallPattern = /\b(?:pip|uv\s+pip)\s+install\b/i;
const toxUvInstallPattern = /\b(?:pip|uv\s+pip)\s+install\b[\s\S]*?\btox-uv\b/i;

function stepIsToxRun(run: string): boolean {
  return toxRunPattern.test(run) && !pipInstallPattern.test(run);
}

function toxConfigFileLocation(text: string): { line: number; column: number } | undefined {
  const patterns = [/(?:^|\s)\[tox\]/i, /\[tool\.tox\]/i, /requires\s*=.*\btox\b/i];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const before = text.slice(0, Math.max(0, match.index));
      const lines = before.split("\n");
      return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
    }
  }
  return undefined;
}

const toxConfigFileNames = ["tox.ini", "pyproject.toml", "setup.cfg"] as const;

export async function collectToxWithoutToxUvDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  _warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  if (!repository.python.usesTox) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, _warnings ?? []);

  let anyWorkflowRunsTox = false;
  let anyWorkflowHasToxUv = false;

  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        if (stepIsToxRun(run)) {
          anyWorkflowRunsTox = true;
        }
        if (!anyWorkflowHasToxUv && toxUvInstallPattern.test(run)) {
          anyWorkflowHasToxUv = true;
        }
      }
    }
  }

  // If tox is used in CI and tox-uv is already installed, skip
  if (anyWorkflowRunsTox && anyWorkflowHasToxUv) {
    return [];
  }

  let location: SourceLocation | undefined;

  for (const fileName of toxConfigFileNames) {
    const configPath = context.resolve(fileName);
    if (!(await context.pathExists(configPath))) {
      continue;
    }
    const configText = await context.readTextFileOrWarn(configPath);
    if (!configText) {
      continue;
    }

    const found = toxConfigFileLocation(configText);
    if (found) {
      location = { path: fileName, line: found.line, column: found.column };
      break;
    }
  }

  location ??= { path: "tox.ini", line: 1, column: 1 };

  const reason = anyWorkflowRunsTox
    ? "CI workflows run tox without tox-uv installed."
    : "Repository uses tox, but no CI workflow installs tox-uv.";

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location,
      message: `${reason} tox-uv can speed up tox venv creation and dependency installation with no config changes.`,
      why: "tox-uv is a plugin that replaces tox's default venv creation and package installation with uv's faster resolver and installer. It requires no config changes and is auto-discovered when installed alongside tox.",
      suggestion:
        "Add tox-uv to tox installation steps in CI workflows (e.g., replace `pip install tox` with `pip install tox tox-uv`).",
      measurementHint:
        "Compare total CI job duration before and after adding tox-uv to tox installation steps.",
      aiHandoff:
        "Review CI workflows for tox usage and add tox-uv to tox installation steps. tox-uv is auto-discovered as a tox 4+ plugin and requires no configuration changes.",
      score: 42,
    }),
  ];
}
