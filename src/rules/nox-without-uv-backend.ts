import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "nox-without-uv-backend",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/nox-without-uv-backend.md",
} satisfies RuleMeta;

const noxRunPattern = /(?:^|\s)(?:(?:python|python3)\s+-m\s+)?nox(?:\s|$)/i;
const pipInstallPattern = /\b(?:pip|uv\s+pip)\s+install\b/i;
const uvFlagPattern = /--uv\b/i;

function stepRunsNox(run: string): boolean {
  return noxRunPattern.test(run) && !pipInstallPattern.test(run);
}

function stepHasUvFlag(run: string): boolean {
  return uvFlagPattern.test(run);
}

function findNoxStepsWithoutUvFlag(steps: { run?: string }[]): number[] {
  return steps
    .map((step, i) => {
      const run = step.run ?? "";
      return stepRunsNox(run) && !stepHasUvFlag(run) ? i : -1;
    })
    .filter((i) => i !== -1);
}

export const noxWithoutUvBackendRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (!context.repository.python.usesNox) {
      return [];
    }

    return workflow.jobs.flatMap((job) => {
      const noxSteps = findNoxStepsWithoutUvFlag(job.steps);
      if (noxSteps.length === 0) {
        return [];
      }

      return noxSteps.map((stepIndex) => {
        const step = job.steps[stepIndex]!;
        return buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
          message: `Job "${job.id}" runs nox without the --uv flag.`,
          why: "nox can use uv for virtualenv creation and package installation by passing the --uv flag or setting nox.options.uv = True in noxfile.py. This speeds up session setup with no behavioral changes.",
          suggestion:
            'Add "--uv" to the nox command (e.g., "nox --uv -s <session>") or add "nox.options.uv = True" to noxfile.py.',
          measurementHint: "Compare nox session setup time before and after adding --uv.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and add --uv to the nox command or set nox.options.uv = True in noxfile.py.`,
          score: 42,
        });
      });
    });
  },
};
