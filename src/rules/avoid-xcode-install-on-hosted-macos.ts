import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobRunsOnHostedMacos, jobUsesContainer } from "./shared/workflow-jobs.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";

const meta = {
  id: "avoid-xcode-install-on-hosted-macos",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/avoid-xcode-install-on-hosted-macos.md",
} satisfies RuleMeta;

function getXcodeInstallStep(
  steps: WorkflowStep[],
): { step: WorkflowStep; command: string } | undefined {
  for (const step of steps) {
    for (const [tool, action, ...args] of shellInvocations(step.run ?? "", false)) {
      if ([action, ...args].some((arg) => ["--help", "-h", "--version"].includes(arg ?? ""))) {
        continue;
      }
      if ((tool === "xcodes" || tool === "xcversion") && action === "install") {
        return { step, command: [tool, action, ...args].join(" ") };
      }
      if (tool === "mise" && action === "install" && args[0]?.startsWith("xcode@")) {
        return { step, command: [tool, action, ...args].join(" ") };
      }
      if (
        tool === "xip" &&
        action === "--expand" &&
        /(?:^|\/)Xcode[^\s]*\.xip$/i.test(args[0] ?? "")
      ) {
        return { step, command: args[0]! };
      }
      if (["curl", "wget", "aria2c"].includes(tool ?? "")) {
        const words = [action, ...args];
        for (let index = 0; index < words.length; index++) {
          const word = words[index] ?? "";
          if (
            [
              "-H",
              "--header",
              "-d",
              "--data",
              "--data-raw",
              "--data-binary",
              "--post-data",
              "-o",
              "--output",
              "-O",
              "--output-document",
              "-A",
              "--user-agent",
              "-e",
              "--referer",
            ].includes(word) &&
            !(tool === "curl" && word === "-O")
          ) {
            index++;
          } else if (/^(?:https?|ftp):\/\/[^\s]*\/Xcode[^\s/?#]*\.xip(?:[?#].*)?$/i.test(word)) {
            return { step, command: word };
          }
        }
      }
    }
  }
  return undefined;
}

function getRequestedXcodeVersion(run: string): string | undefined {
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
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (!jobRunsOnHostedMacos(job) || jobUsesContainer(job)) {
        continue;
      }

      const install = getXcodeInstallStep(job.steps);
      if (!install) {
        continue;
      }

      const { step: installStep, command } = install;
      const requestedVersion = getRequestedXcodeVersion(command);
      const versionPhrase = requestedVersion ? ` requested Xcode ${requestedVersion}` : " Xcode";

      findings.push(
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
      );
    }
    return findings;
  },
};
