import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { hasSetupUvStep } from "./shared/workflow-analysis.ts";

const meta = {
  id: "prefer-uv-pip-over-pip",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-uv-pip-over-pip.md",
} satisfies RuleMeta;

const pipInstallPattern = /\bpip\s+install\b/i;
const uvPipInstallPattern = /\buv\s+pip\s+install\b/i;

function jobHasPlainPipInstall(steps: { run?: string }[]): boolean {
  return steps.some(
    (step) => pipInstallPattern.test(step.run ?? "") && !uvPipInstallPattern.test(step.run ?? ""),
  );
}

function findPipInstallSteps(steps: { run?: string }[]): number[] {
  return steps
    .map((step, i) => {
      const run = step.run ?? "";
      return pipInstallPattern.test(run) && !uvPipInstallPattern.test(run) ? i : -1;
    })
    .filter((i) => i !== -1);
}

export const preferUvPipOverPipRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      if (!hasSetupUvStep(job) || !jobHasPlainPipInstall(job.steps)) {
        return [];
      }

      const pipSteps = findPipInstallSteps(job.steps);

      return pipSteps.map((stepIndex) => {
        const step = job.steps[stepIndex]!;
        const run = step.run ?? "";
        const packageText = run.replace(/^pip\s+install\s*/i, "").trim();

        return buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
          message: `Job "${job.id}" uses pip install but setup-uv is available; prefer "uv pip install" for faster installs.`,
          why: "uv pip install is a drop-in replacement for pip install that is significantly faster, especially for projects with many dependencies. It accepts the same arguments, reads the same requirements files, and installs into the same environment.",
          suggestion: `Replace "pip install ${packageText}" with "uv pip install ${packageText}".`,
          measurementHint:
            "Compare pip install vs uv pip install wall-clock time for the same package set.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and replace "pip install" with "uv pip install" in steps where setup-uv is already available. uv pip install is a drop-in replacement.`,
          score: 56,
        });
      });
    });
  },
};
