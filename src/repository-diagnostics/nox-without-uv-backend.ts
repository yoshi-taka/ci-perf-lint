import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import path from "node:path";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  collectNoxCommands,
  noxConfigHasBackendChoice,
  noxHasBackendChoice,
} from "../rules/shared/nox-commands.ts";
import {
  workflowStepEnv,
  workflowWorkingDirectory,
} from "../rules/shared/workflow-command-context.ts";

const meta = {
  id: "nox-without-uv-backend",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/nox-without-uv-backend.md",
} satisfies RuleMeta;

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
  const context = scanContext ?? new RepositoryScanContext(repoRoot, _warnings ?? []);
  let runsNox = false;
  let untuned = false;
  let untunedFile: string | undefined;
  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        for (const command of collectNoxCommands(
          step.run ?? "",
          workflowStepEnv(workflow, job, step),
        )) {
          runsNox = true;
          if (
            command.needsUv &&
            !(await noxHasBackendChoice(
              context,
              command.noxfile,
              workflowWorkingDirectory(workflow, job, step),
            ))
          ) {
            untuned = true;
            untunedFile ??= path
              .relative(
                repoRoot,
                context.resolve(workflowWorkingDirectory(workflow, job, step), command.noxfile),
              )
              .split(path.sep)
              .join("/");
          }
        }
      }
    }
  }
  if (runsNox && !untuned) {
    return [];
  }
  if (!runsNox) {
    const file = context.resolve("noxfile.py");
    if (
      !(await context.pathExists(file)) ||
      noxConfigHasBackendChoice((await context.readTextFileOrWarn(file)) ?? "")
    ) {
      return [];
    }
  }
  const reason = runsNox
    ? "CI workflows run nox without visible backend selection."
    : "Repository uses nox.";
  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: untunedFile ?? "noxfile.py", line: 1, column: 1 },
      message: `${reason} Select the uv backend in CI or in the applicable noxfile to reduce session setup time.`,
      why: "The uv backend can reduce nox virtualenv creation and package installation time. Verify session requirements and pip compatibility when changing the backend.",
      suggestion:
        'Use "--default-venv-backend=uv" in untuned CI commands or set nox.options.default_venv_backend = "uv" in the applicable noxfile. Preserve explicit backend choices.',
      measurementHint: "Compare nox session setup time before and after enabling uv backend.",
      aiHandoff:
        "Review untuned nox commands and their applicable noxfiles. Select uv only where session requirements permit it, preserving explicit backend choices and session arguments.",
      score: 42,
    }),
  ];
}
