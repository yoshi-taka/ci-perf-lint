import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "nox-without-uv-backend",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/nox-without-uv-backend.md",
} satisfies RuleMeta;

const noxRunPattern = /(?:^|\s)(?:(?:python|python3)\s+-m\s+)?nox(?:\s|$)/i;
const pipInstallPattern = /\b(?:pip|uv\s+pip)\s+install\b/i;
const uvFlagPattern = /--uv\b/i;

export async function collectNoxWithoutUvBackendDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  _warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  if (!repository.python.usesNox) {
    return [];
  }

  let anyWorkflowRunsNox = false;
  let anyWorkflowHasUvFlag = false;

  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        if (noxRunPattern.test(run) && !pipInstallPattern.test(run)) {
          anyWorkflowRunsNox = true;
        }
        if (uvFlagPattern.test(run)) {
          anyWorkflowHasUvFlag = true;
        }
      }
    }
  }

  if (anyWorkflowRunsNox && anyWorkflowHasUvFlag) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, _warnings ?? []);
  let hasNoxfileUvOption = false;
  let location: SourceLocation | undefined;

  const noxFilePath = context.resolve("noxfile.py");
  if (await context.pathExists(noxFilePath)) {
    const text = await context.readTextFileOrWarn(noxFilePath);
    if (text) {
      hasNoxfileUvOption = /uv\s*=\s*True/i.test(text);
      if (hasNoxfileUvOption && anyWorkflowRunsNox) {
        return [];
      }

      const uvOptionMatch = /uv\s*=\s*True/i.exec(text);
      if (uvOptionMatch) {
        const before = text.slice(0, Math.max(0, uvOptionMatch.index));
        const lines = before.split("\n");
        location = {
          path: "noxfile.py",
          line: lines.length,
          column: (lines.at(-1)?.length ?? 0) + 1,
        };
      }
      location ??= { path: "noxfile.py", line: 1, column: 1 };
    } else {
      location = { path: "noxfile.py", line: 1, column: 1 };
    }
  } else {
    location = { path: "noxfile.py", line: 1, column: 1 };
  }

  if (hasNoxfileUvOption) {
    return [];
  }

  const reason = anyWorkflowRunsNox ? "CI workflows run nox without --uv." : "Repository uses nox.";

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location,
      message: `${reason} Add "--uv" flag or set nox.options.uv = True in noxfile.py to use uv backend.`,
      why: "nox can use uv for virtualenv creation and package installation by passing the --uv flag or setting nox.options.uv = True in noxfile.py. This speeds up session setup with no behavioral changes.",
      suggestion: 'Add "--uv" to nox commands in CI or add "nox.options.uv = True" to noxfile.py.',
      measurementHint: "Compare nox session setup time before and after enabling uv backend.",
      aiHandoff: "Review CI workflows and noxfile.py to enable uv backend for nox.",
      score: 42,
    }),
  ];
}
