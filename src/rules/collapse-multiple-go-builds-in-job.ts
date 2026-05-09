import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getJobStepAnalysis, goBuildOccurrenceCountInRun } from "./shared/job-step-analysis.ts";

const meta = {
  id: "collapse-multiple-go-builds-in-job",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/collapse-multiple-go-builds-in-job.md",
} satisfies RuleMeta;

function stepHasMultiPackageGoBuild(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  if (!/\bgo\s+build\b/i.test(run)) {
    return false;
  }

  const normalized = run.replace(/\\\r?\n/g, " ").replace(/\s+/g, " ");
  const match = normalized.match(/\bgo\s+build\b([\s\S]*?)(?:&&|\|\||;|\n|$)/i);
  const args = match?.[1] ?? "";
  const packageArgs = args
    .split(/\s+/)
    .filter((token) => token.startsWith("./") && !token.includes("="));
  return packageArgs.length >= 2;
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

      const firstBuildStep = job.steps.find(
        (step) => goBuildOccurrenceCountInRun(step.run ?? "") > 0,
      );
      if (!firstBuildStep) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, firstBuildStep.runNode ?? firstBuildStep.node, {
          message: `Job "${job.id}" runs ${analysis.goBuildOccurrenceTotal} separate \`go build\` commands.`,
          why: "Building multiple Go packages or binaries in one go command can reuse compiler work and module/cache state more efficiently than separate sequential go build invocations.",
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
