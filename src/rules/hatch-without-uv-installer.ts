import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { textRunsTool } from "./shared/tool-command-evidence.ts";

const meta = {
  id: "hatch-without-uv-installer",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/hatch-without-uv-installer.md",
} satisfies RuleMeta;

function stepRunsHatch(stepText: string): boolean {
  return textRunsTool(stepText, "hatch");
}

function jobRunsHatch(steps: { run?: string; name?: string }[]): boolean {
  return steps.some((step) => stepRunsHatch(step.run ?? ""));
}

export const hatchWithoutUvInstallerRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (!context.repository.hatch.usesHatch || context.repository.hatch.usesUvInstaller) {
      return [];
    }

    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (!jobRunsHatch(job.steps)) {
        continue;
      }

      const hatchStep = job.steps.find((step) => stepRunsHatch(step.run ?? ""));
      if (!hatchStep) {
        continue;
      }

      findings.push(
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
      );
    }
    return findings;
  },
};
