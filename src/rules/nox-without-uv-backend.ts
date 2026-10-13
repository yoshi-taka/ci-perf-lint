import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectNoxCommands, noxHasBackendChoice } from "./shared/nox-commands.ts";
import { workflowStepEnv, workflowWorkingDirectory } from "./shared/workflow-command-context.ts";

const meta = {
  id: "nox-without-uv-backend",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/nox-without-uv-backend.md",
} satisfies RuleMeta;

export const noxWithoutUvBackendRule = {
  meta,
  async check(workflow: WorkflowDocument, context: RuleContext) {
    if (!context.repository.python.usesNox) {
      return [];
    }

    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const commands = collectNoxCommands(step.run ?? "", workflowStepEnv(workflow, job, step));
        let untuned = false;
        for (const command of commands) {
          if (
            command.needsUv &&
            !(await noxHasBackendChoice(
              context.scanContext,
              command.noxfile,
              workflowWorkingDirectory(workflow, job, step),
            ))
          ) {
            untuned = true;
            break;
          }
        }
        if (!untuned) {
          continue;
        }
        findings.push(
          buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
            message: `Job "${job.id}" runs nox without visible backend selection.`,
            why: "The uv backend can reduce nox virtualenv creation and package installation time. Verify session requirements and pip compatibility when changing the backend.",
            suggestion:
              'Select uv with "--default-venv-backend=uv" (e.g., "nox --default-venv-backend=uv -s <session>") or set nox.options.default_venv_backend = "uv" in the applicable noxfile. Preserve session-specific backend requirements.',
            measurementHint:
              "Compare nox session setup time before and after selecting the uv backend.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and select the uv backend for the identified nox commands when compatible with their sessions. Preserve command boundaries, session arguments and applicable noxfile settings.`,
            score: 42,
          }),
        );
      }
    }

    return findings;
  },
};
