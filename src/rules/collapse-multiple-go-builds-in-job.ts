import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "collapse-multiple-go-builds-in-job",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/collapse-multiple-go-builds-in-job.md",
} satisfies RuleMeta;

function goBuildOccurrenceCount(run: string): number {
  return run.match(/\bgo\s+build(?:\s|$)/gi)?.length ?? 0;
}

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

      const goBuildSteps = job.steps.filter((step) => goBuildOccurrenceCount(step.run ?? "") > 0);
      const totalOccurrences = goBuildSteps.reduce(
        (count, step) => count + goBuildOccurrenceCount(step.run ?? ""),
        0,
      );
      if (totalOccurrences < 2 || goBuildSteps.some((step) => stepHasMultiPackageGoBuild(step))) {
        continue;
      }

      const firstStep = goBuildSteps[0];
      findings.push(
        buildDiagnostic(workflow, meta, firstStep?.runNode ?? firstStep?.node, {
          message: `Job "${job.id}" runs ${totalOccurrences} separate \`go build\` commands.`,
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
