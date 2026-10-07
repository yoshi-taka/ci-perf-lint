import type { Diagnostic, RuleMeta } from "../types.ts";
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

    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (!jobRunsPdm(job.steps)) {
        continue;
      }

      const pdmStep = job.steps.find((step) => stepRunsPdm(`${step.name ?? ""} ${step.run ?? ""}`));
      if (!pdmStep) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, pdmStep.runNode ?? pdmStep.node, {
          message: `Job "${job.id}" runs pdm commands without "use_uv = true" configured.`,
          why: "PDM can use uv for dependency resolution and installation through its use_uv configuration, speeding up lock operations and package installation.",
          suggestion:
            'Install uv and run "pdm config --local use_uv true", which writes use_uv = true to pdm.toml.',
          measurementHint: "Compare pdm lock and install times before and after enabling use_uv.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and PDM uv-backend compatibility, then install uv and run "pdm config --local use_uv true" to enable the backend in pdm.toml.`,
          score: 46,
        }),
      );
    }
    return findings;
  },
};
