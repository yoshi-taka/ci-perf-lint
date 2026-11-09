import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  jobRunsOnHostedMacos,
  jobRunsOnHostedUbuntu,
  jobRunsOnHostedWindows,
  jobUsesContainer,
} from "./shared/workflow-jobs.ts";
import {
  cliInstallationCommands,
  commandPinsCliVersion,
  type PreinstalledCli,
} from "./shared/preinstalled-cli-commands.ts";
import { declaredShellEnvironmentNames } from "./shared/shell-environment-evidence.ts";
import { shellNonDisplayInvocations } from "./shared/shell-invocations.ts";
import { effectiveStepEnvironment } from "./shared/workflow-env.ts";

type RunnerOs = "ubuntu" | "windows" | "macos";
const preinstalledCliRules: {
  cli: PreinstalledCli;
  label: string;
  supportedRunnerOs: RunnerOs[];
}[] = [
  { cli: "aws", label: "AWS CLI", supportedRunnerOs: ["ubuntu", "windows", "macos"] },
  { cli: "az", label: "Azure CLI", supportedRunnerOs: ["ubuntu", "windows", "macos"] },
  { cli: "azcopy", label: "AzCopy", supportedRunnerOs: ["windows", "macos"] },
  { cli: "gh", label: "GitHub CLI", supportedRunnerOs: ["ubuntu", "windows", "macos"] },
  { cli: "helm", label: "Helm", supportedRunnerOs: ["ubuntu", "windows", "macos"] },
  { cli: "jq", label: "jq", supportedRunnerOs: ["ubuntu", "windows", "macos"] },
  { cli: "kubectl", label: "kubectl", supportedRunnerOs: ["ubuntu", "windows", "macos"] },
  { cli: "yq", label: "yq", supportedRunnerOs: ["ubuntu", "macos"] },
];

// Sources:
// - https://docs.github.com/en/actions/concepts/runners/github-hosted-runners
// - https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2204-Readme.md
// - https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md
// - https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md
// - https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md
const meta = {
  id: "redundant-install-for-preinstalled-cli",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/redundant-install-for-preinstalled-cli.md",
} satisfies RuleMeta;

const versionEnvVarForCli: Record<PreinstalledCli, string> = {
  aws: "AWS_CLI_VERSION",
  az: "AZ_VERSION",
  azcopy: "AZCOPY_VERSION",
  gh: "GH_VERSION",
  helm: "HELM_VERSION",
  jq: "JQ_VERSION",
  kubectl: "KUBECTL_VERSION",
  yq: "YQ_VERSION",
};

function stepPinsVersion(step: WorkflowStep, cli: PreinstalledCli): boolean {
  const text = step.run ?? "";
  const variable = versionEnvVarForCli[cli];
  if (declaredShellEnvironmentNames(text).has(variable)) {
    return true;
  }
  const reference = new RegExp(`\\b${variable}\\b`);
  return cliInstallationCommands(text, cli).some(
    (words) => commandPinsCliVersion(words, cli) || words.some((word) => reference.test(word)),
  );
}

function jobPinsVersion(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  installStepIndex: number,
  cli: PreinstalledCli,
): boolean {
  for (let index = 0; index <= installStepIndex; index++) {
    if (stepPinsVersion(job.steps[index]!, cli)) {
      return true;
    }
  }
  return (
    versionEnvVarForCli[cli] in
    effectiveStepEnvironment(workflow, job, job.steps[installStepIndex]!)
  );
}

function getFirstInstallStep(job: WorkflowJob, cli: PreinstalledCli): WorkflowStep | undefined {
  return job.steps.find((step) => cliInstallationCommands(step.run ?? "", cli).length > 0);
}

function jobUsesCliAfterInstall(
  job: WorkflowJob,
  cli: PreinstalledCli,
  installStep: WorkflowStep,
): boolean {
  const installIndex = job.steps.indexOf(installStep);
  if (installIndex < 0) {
    return false;
  }
  return job.steps.slice(installIndex + 1).some((step) =>
    shellNonDisplayInvocations(step.run ?? "", true).some(
      ([tool]) =>
        tool
          ?.split(/[\\/]/)
          .at(-1)
          ?.replace(/\.exe$/i, "")
          .toLowerCase() === cli,
    ),
  );
}

function getHostedRunnerOs(job: WorkflowJob): RunnerOs | undefined {
  if (jobRunsOnHostedUbuntu(job)) {
    return "ubuntu";
  }
  if (jobRunsOnHostedWindows(job)) {
    return "windows";
  }
  if (jobRunsOnHostedMacos(job)) {
    return "macos";
  }
  return undefined;
}

export const redundantInstallForPreinstalledCliRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      const runnerOs = getHostedRunnerOs(job);
      if (!runnerOs || jobUsesContainer(job)) {
        continue;
      }
      for (const { cli, label, supportedRunnerOs } of preinstalledCliRules) {
        if (!supportedRunnerOs.includes(runnerOs)) {
          continue;
        }
        const installStep = getFirstInstallStep(job, cli);
        if (!installStep || jobPinsVersion(workflow, job, job.steps.indexOf(installStep), cli)) {
          continue;
        }
        if (!jobUsesCliAfterInstall(job, cli, installStep)) {
          continue;
        }
        const runnerLabel =
          runnerOs === "windows" ? "Windows" : runnerOs === "macos" ? "macOS" : "Ubuntu";
        findings.push(
          buildDiagnostic(workflow, meta, installStep.runNode ?? installStep.node, {
            message: `Job "${job.id}" installs ${label} even though GitHub-hosted ${runnerLabel} runners already include it.`,
            why: `GitHub-hosted ${runnerLabel} images already ship with ${label}, so reinstalling it can add avoidable setup time when the job does not need a pinned version.`,
            suggestion: `If this job does not require a pinned newer ${label} version, remove the extra install step and use the preinstalled ${cli} command.`,
            measurementHint:
              "Compare total job duration before and after removing the redundant CLI install step.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and, if it runs on GitHub-hosted ${runnerLabel} without requiring a pinned ${label} version, remove the extra install step and use the preinstalled ${cli} command instead.`,
            score: 55,
          }),
        );
      }
    }
    return findings;
  },
};
