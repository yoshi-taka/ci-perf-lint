import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";
import { expandPackageScriptSegments, packageScriptMap } from "./shared/npm-script-expansion.ts";
import { prettierCheckTarget } from "./shared/prettier-check-evidence.ts";

const meta = {
  id: "avoid-duplicate-prettier-check",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-duplicate-prettier-check.md",
} satisfies RuleMeta;

interface Occurrence {
  step: WorkflowStep;
  target: string;
}

export const avoidDuplicatePrettierCheckRule = {
  meta,
  async check(workflow: WorkflowDocument, context: RuleContext) {
    const packageJson = await context.scanContext?.loadPackageJson();
    const scripts = packageScriptMap(packageJson?.value);
    if (scripts.size === 0) {
      return [];
    }

    const occurrences = new Map<string, Occurrence[]>();
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || jobHasMatrix(job)) {
        continue;
      }
      for (const step of job.steps) {
        if (!step.run) {
          continue;
        }
        for (const segment of expandPackageScriptSegments(step.run, scripts)) {
          const target = prettierCheckTarget(segment);
          if (!target) {
            continue;
          }
          const list = occurrences.get(target) ?? [];
          list.push({ step, target });
          occurrences.set(target, list);
        }
      }
    }

    return [...occurrences.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([target, list]) => {
        const first = list[0]!;
        const labels = [...new Set(list.map((entry) => entry.step.name ?? "(unnamed)"))];
        return buildDiagnostic(workflow, meta, first.step.runNode ?? first.step.node, {
          message: `Prettier runs \`--check ${target}\` more than once in this workflow (${labels.join(", ")}).`,
          why: "A package script such as `prettier --check . && eslint .` can hide a formatting check that a separate step also runs. Both runs cover the same file scope, so the second pass repeats work without adding coverage.",
          suggestion:
            "Keep one Prettier check for that scope: either remove it from the composite script or drop the dedicated step, then run ESLint without the duplicated formatting pass.",
          measurementHint:
            "Compare step durations and total runner minutes after removing one of the identical `prettier --check` invocations, and confirm the check still fails on formatting drift.",
          aiHandoff: `Review the ${labels.join(", ")} steps in ${workflow.relativePath} and the package scripts they call. Remove only the redundant \`prettier --check ${target}\` call while preserving formatting enforcement.`,
          score: 64,
        });
      });
  },
};
