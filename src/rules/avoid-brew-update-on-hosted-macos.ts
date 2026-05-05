import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getWorkflowStepText } from "./shared/workflow-step-text.ts";
import { jobRunsOnHostedMacos, jobUsesContainer } from "./shared/workflow-jobs.ts";

const meta = {
  id: "avoid-brew-update-on-hosted-macos",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/avoid-brew-update-on-hosted-macos.md",
} satisfies RuleMeta;

const brewUpdatePattern = /\bbrew\s+(?:update|upgrade)\b/i;

function getBrewUpdateStep(steps: WorkflowStep[]): WorkflowStep | undefined {
  return steps.find((step) => brewUpdatePattern.test(getWorkflowStepText(step)));
}

export const avoidBrewUpdateOnHostedMacosRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (!jobRunsOnHostedMacos(job) || jobUsesContainer(job)) {
        continue;
      }

      const updateStep = getBrewUpdateStep(job.steps);
      if (!updateStep) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, updateStep.runNode ?? updateStep.node, {
          message: `Job "${job.id}" runs brew update or brew upgrade on a GitHub-hosted macOS runner.`,
          why: "GitHub-hosted macOS runner images are refreshed regularly. Updating Homebrew during every CI run can add avoidable setup time and make the job less reproducible.",
          suggestion:
            "Remove the Homebrew update or upgrade step unless the job explicitly requires a newer formula than the runner image provides. Check the runner image's Included Software list for toolchains such as Java, LLVM, GCC, CMake, or Ninja before upgrading them in CI.",
          measurementHint:
            "Compare setup time and total job duration before and after removing the Homebrew update or upgrade step.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}", check the selected macOS runner image's Included Software list for any toolchain being upgraded, and remove the Homebrew update or upgrade step unless this CI path intentionally validates the newest formula state or requires a newer package than the hosted macOS image provides.`,
          score: 50,
        }),
      );
    }
    return findings;
  },
};
