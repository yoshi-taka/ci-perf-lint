import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "pdm-without-use-uv",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/pdm-without-use-uv.md",
} satisfies RuleMeta;

const pdmCommandPattern = /(?:^|\s)(?:(?:python|python3)\s+-m\s+)?pdm(?:\s|$)/i;
const pipInstallPattern = /\b(?:pip|uv\s+pip)\s+install\b/i;

function stepRunsPdm(stepText: string): boolean {
  return pdmCommandPattern.test(stepText) && !pipInstallPattern.test(stepText);
}

function jobRunsPdm(steps: { run?: string; name?: string }[]): boolean {
  return steps.some((step) => stepRunsPdm(`${step.name ?? ""} ${step.run ?? ""}`));
}

export const pdmWithoutUseUvRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (!context.repository.pdm.usesPdm || context.repository.pdm.usesUv) {
      return [];
    }

    return workflow.jobs.flatMap((job) => {
      if (!jobRunsPdm(job.steps)) {
        return [];
      }

      const pdmStep = job.steps.find((step) => stepRunsPdm(`${step.name ?? ""} ${step.run ?? ""}`));
      if (!pdmStep) {
        return [];
      }

      return [
        buildDiagnostic(workflow, meta, pdmStep.runNode ?? pdmStep.node, {
          message: `Job "${job.id}" runs pdm commands without "use_uv = true" configured.`,
          why: "PDM can use uv for dependency resolution and installation by setting use_uv = true in [tool.pdm] in pyproject.toml. This speeds up lock operations and package installation with no workflow changes.",
          suggestion:
            'Run "pdm config use_uv true" or add "use_uv = true" to the [tool.pdm] section of pyproject.toml.',
          measurementHint: "Compare pdm lock and install times before and after enabling use_uv.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and enable uv backend for PDM by running "pdm config use_uv true" or adding use_uv = true to [tool.pdm] in pyproject.toml.`,
          score: 46,
        }),
      ];
    });
  },
};
