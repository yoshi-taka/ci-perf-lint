import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectPlainPipInstalls, pipInstallSuggestion } from "./shared/command-patterns.ts";

const meta = {
  id: "prefer-uv-pip-over-pip",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-uv-pip-over-pip.md",
} satisfies RuleMeta;

export const preferUvPipOverPipRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      const setupIndex = job.steps.findIndex((step) =>
        step.uses?.toLowerCase().startsWith("astral-sh/setup-uv@"),
      );
      if (setupIndex < 0) {
        continue;
      }

      for (const step of job.steps.slice(setupIndex + 1)) {
        const installs = collectPlainPipInstalls(step.run ?? "");
        if (!installs.length) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
            message: `Job "${job.id}" uses pip install but setup-uv is available; prefer "uv pip install" for faster installs.`,
            why: "uv pip install can reduce dependency installation time, especially for projects with many dependencies. Verify the selected Python environment, option compatibility and resolved dependencies when migrating from pip.",
            suggestion: installs.map(pipInstallSuggestion).join("\n"),
            measurementHint:
              "Compare pip install vs uv pip install wall-clock time for the same package set.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and migrate the identified pip install commands to uv where setup-uv is already available. Preserve surrounding commands, the Python environment and dependency selection; translate pip-specific options.`,
            score: 56,
          }),
        );
      }
    }

    return findings;
  },
};
