import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobRunsOnHostedMacos, jobUsesContainer } from "./shared/workflow-jobs.ts";

const meta = {
  id: "avoid-xcode-install-on-hosted-macos",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/avoid-xcode-install-on-hosted-macos.md",
} satisfies RuleMeta;

const xcodeInstallPattern =
  /\b(?:xcodes|xcversion)\s+install\b|\bmise\s+install\s+xcode@|\b(?:curl|wget|aria2c)\b[\s\S]*\bXcode[^ \n]*\.xip\b|\bxip\s+--expand\b[\s\S]*\bXcode[^ \n]*\.xip\b/i;

function getXcodeInstallStep(steps: WorkflowStep[]): WorkflowStep | undefined {
  return steps.find((step) => xcodeInstallPattern.test(step.run ?? ""));
}

function getRequestedXcodeVersion(step: WorkflowStep): string | undefined {
  const run = step.run ?? "";
  const versionPatterns = [
    /\b(?:xcodes|xcversion)\s+install\s+(?:--select\s+)?(?:--latest\s+)?(?:--experimental-unxip\s+)?(?:--no-superuser\s+)?(?:--path\s+\S+\s+)?(?:Xcode\s+)?v?(\d+(?:\.\d+){0,2}(?:\s*(?:beta|rc)\s*\d*)?)/i,
    /\bmise\s+install\s+xcode@v?(\d+(?:\.\d+){0,2}(?:[-_ ]?(?:beta|rc)\d*)?)/i,
    /\bXcode[_-](\d+(?:\.\d+){0,2}(?:[_-]?(?:beta|rc)\d*)?)[^ \n]*\.xip\b/i,
  ];

  for (const pattern of versionPatterns) {
    const match = run.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  return undefined;
}

export const avoidXcodeInstallOnHostedMacosRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      if (!jobRunsOnHostedMacos(job) || jobUsesContainer(job)) {
        return [];
      }

      const installStep = getXcodeInstallStep(job.steps);
      if (!installStep) {
        return [];
      }

      const requestedVersion = getRequestedXcodeVersion(installStep);
      const versionPhrase = requestedVersion ? ` requested Xcode ${requestedVersion}` : " Xcode";

      return [
        buildDiagnostic(workflow, meta, installStep.runNode ?? installStep.node, {
          message: `Job "${job.id}" installs or downloads${versionPhrase} on a GitHub-hosted macOS runner.`,
          why: "GitHub-hosted macOS runner images usually include multiple Xcode versions. Installing Xcode during CI can add very large setup time unless the requested version is not present on the selected runner image.",
          suggestion:
            "Check the runner image's Included Software list. If the requested Xcode version is already present, replace the install with xcode-select or DEVELOPER_DIR. If it is not present, pin the runner label and keep the install only if the extra setup time is acceptable.",
          measurementHint:
            "Compare Xcode setup time and total job duration before and after replacing the install with a preinstalled Xcode selection.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}", check whether${versionPhrase} is already included on the selected macOS runner image, and replace the install or download with xcode-select or DEVELOPER_DIR when possible.`,
          score: 58,
        }),
      ];
    });
  },
};
