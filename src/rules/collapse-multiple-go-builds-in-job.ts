import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getJobStepAnalysis } from "./shared/job-step-analysis.ts";
import { collectGoBuildCommands } from "./shared/go-build-commands.ts";
import { workflowStepEnv, workflowWorkingDirectory } from "./shared/workflow-command-context.ts";

const meta = {
  id: "collapse-multiple-go-builds-in-job",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/collapse-multiple-go-builds-in-job.md",
} satisfies RuleMeta;

function stepHasMultiPackageGoBuild(step: WorkflowStep): boolean {
  return collectGoBuildCommands(step.run ?? "").some((command) => command.targets.length >= 2);
}

export const collapseMultipleGoBuildsInJobRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const analysis = getJobStepAnalysis(job);
      if (analysis.goBuildOccurrenceTotal < 2) {
        continue;
      }

      if (job.steps.some((step) => stepHasMultiPackageGoBuild(step))) {
        continue;
      }

      const groups = new Map<string, WorkflowStep[]>();
      for (const step of job.steps) {
        const env = Object.entries(workflowStepEnv(workflow, job, step)).sort(([a], [b]) =>
          a.localeCompare(b),
        );
        for (const command of collectGoBuildCommands(step.run ?? "")) {
          const key = JSON.stringify([
            command.variant,
            workflowWorkingDirectory(workflow, job, step),
            env,
            step.if ?? "",
          ]);
          const group = groups.get(key) ?? [];
          group.push(step);
          groups.set(key, group);
        }
      }
      const compatible = [...groups.values()].find((group) => group.length >= 2);
      const firstBuildStep = compatible?.[0];
      if (!firstBuildStep) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, firstBuildStep.runNode ?? firstBuildStep.node, {
          message: `Job "${job.id}" runs ${compatible.length} separate \`go build\` commands.`,
          why: "These Go builds have matching visible compilation flags, environment, working directory and step conditions. Combining compatible targets may reduce invocation overhead; Go's build cache already reuses compiler results across separate processes, so repeated commands alone do not prove recompilation.",
          suggestion:
            "Collapse separate Go binary builds into one `go build` command where output layout allows it, or use one scripted build step that builds packages together before Docker packaging.",
          measurementHint:
            "Compare Go build wall-clock time before and after replacing repeated go build commands with one multi-package build.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and combine repeated \`go build\` commands when they are building related packages for the same image or release set.`,
          score: 66,
        }),
      );
    }
    return findings;
  },
};
