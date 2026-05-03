import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "hatch-without-uv-installer",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/hatch-without-uv-installer.md",
} satisfies RuleMeta;

const hatchCommandPattern = /(?:^|\s)(?:(?:python|python3)\s+-m\s+)?hatch(?:\s|$)/i;
const pipInstallPattern = /\b(?:pip|uv\s+pip)\s+install\b/i;

function stepRunsHatch(stepText: string): boolean {
  return hatchCommandPattern.test(stepText) && !pipInstallPattern.test(stepText);
}

function jobRunsHatch(steps: { run?: string; name?: string }[]): boolean {
  return steps.some((step) => stepRunsHatch(`${step.name ?? ""} ${step.run ?? ""}`));
}

export const hatchWithoutUvInstallerRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (!context.repository.hatch.usesHatch || context.repository.hatch.usesUvInstaller) {
      return [];
    }

    return workflow.jobs.flatMap((job) => {
      if (!jobRunsHatch(job.steps)) {
        return [];
      }

      const hatchStep = job.steps.find((step) =>
        stepRunsHatch(`${step.name ?? ""} ${step.run ?? ""}`),
      );
      if (!hatchStep) {
        return [];
      }

      return [
        buildDiagnostic(workflow, meta, hatchStep.runNode ?? hatchStep.node, {
          message: `Job "${job.id}" runs hatch commands without "installer = \\"uv\\"" configured.`,
          why: 'Hatch can use uv for dependency installation by setting installer = "uv" in [tool.hatch.env] in pyproject.toml or [env] in hatch.toml. This speeds up environment creation with no workflow changes.',
          suggestion:
            'Add "installer = \\"uv\\"" to the [tool.hatch.env] section of pyproject.toml (or [env] section of hatch.toml).',
          measurementHint:
            "Compare hatch environment creation time before and after adding the uv installer setting.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and add installer = "uv" to the project's hatch config. The setting lives in [tool.hatch.env] in pyproject.toml or [env] in hatch.toml.`,
          score: 46,
        }),
      ];
    });
  },
};
