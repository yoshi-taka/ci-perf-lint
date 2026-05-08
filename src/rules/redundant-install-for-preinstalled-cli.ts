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

type RunnerOs = "ubuntu" | "windows" | "macos";
type PreinstalledCli = "aws" | "az" | "azcopy" | "gh" | "helm" | "jq" | "kubectl" | "yq";

const preinstalledCliRules: {
  cli: PreinstalledCli;
  label: string;
  supportedRunnerOs: RunnerOs[];
  installMatcher: RegExp;
  useMatcher: RegExp;
}[] = [
  {
    cli: "aws",
    label: "AWS CLI",
    supportedRunnerOs: ["ubuntu", "windows", "macos"],
    installMatcher:
      /\b(?:apt(?:-get)?\s+install|brew\s+install|choco\s+install|scoop\s+install|winget\s+install|pipx?\s+install|curl\b.*awscliv2|\.\/aws\/install|unzip\b.*awscliv2|install-aws-cli)\b.*\baws(?:cli)?\b/i,
    useMatcher: /(?:^|\s)aws(?:\s|$)/i,
  },
  {
    cli: "az",
    label: "Azure CLI",
    supportedRunnerOs: ["ubuntu", "windows", "macos"],
    installMatcher:
      /\b(?:apt(?:-get)?\s+install|brew\s+install|choco\s+install|scoop\s+install|winget\s+install|pipx?\s+install)\b.*\b(?:azure-cli|microsoft\.azurecli)\b|\baz\s+upgrade\b|\bInstallAzureCLI\b/i,
    useMatcher: /(?:^|\s)az(?:\s|$)/i,
  },
  {
    cli: "azcopy",
    label: "AzCopy",
    supportedRunnerOs: ["windows", "macos"],
    installMatcher:
      /\b(?:brew\s+install|choco\s+install|scoop\s+install|winget\s+install)\b.*\bazcopy(?:10)?\b|\binstall-azcopy\b/i,
    useMatcher: /(?:^|\s)azcopy(?:\s|$)/i,
  },
  {
    cli: "gh",
    label: "GitHub CLI",
    supportedRunnerOs: ["ubuntu", "windows", "macos"],
    installMatcher:
      /\b(?:apt(?:-get)?\s+install|brew\s+install|choco\s+install|scoop\s+install|winget\s+install)\b.*\b(?:gh|github\.cli)\b|\binstall-gh\b/i,
    useMatcher: /(?:^|\s)gh(?:\s|$)/i,
  },
  {
    cli: "helm",
    label: "Helm",
    supportedRunnerOs: ["ubuntu", "windows", "macos"],
    installMatcher:
      /\b(?:apt(?:-get)?\s+install|brew\s+install|choco\s+install|scoop\s+install|winget\s+install|snap\s+install)\b.*\bhelm\b|\binstall-helm\b|\bget-helm-3\b/i,
    useMatcher: /(?:^|\s)helm(?:\s|$)/i,
  },
  {
    cli: "jq",
    label: "jq",
    supportedRunnerOs: ["ubuntu", "windows", "macos"],
    installMatcher:
      /\b(?:apt(?:-get)?\s+install|brew\s+install|choco\s+install|scoop\s+install|winget\s+install)\b.*\bjq\b|\binstall-jq\b/i,
    useMatcher: /(?:^|\s)jq(?:\s|$)/i,
  },
  {
    cli: "kubectl",
    label: "kubectl",
    supportedRunnerOs: ["ubuntu", "windows", "macos"],
    installMatcher:
      /\b(?:apt(?:-get)?\s+install|brew\s+install|choco\s+install|scoop\s+install|winget\s+install|snap\s+install)\b.*\b(?:kubectl|kubernetes-cli)\b|\binstall-kubectl\b|\bdl\.k8s\.io\b/i,
    useMatcher: /(?:^|\s)kubectl(?:\s|$)/i,
  },
  {
    cli: "yq",
    label: "yq",
    supportedRunnerOs: ["ubuntu", "macos"],
    installMatcher:
      /\b(?:apt(?:-get)?\s+install|brew\s+install|choco\s+install|scoop\s+install|snap\s+install)\b.*\byq\b|\binstall-yq\b/i,
    useMatcher: /(?:^|\s)yq(?:\s|$)/i,
  },
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

const versionEnvVarPattern = new RegExp(
  `\\b(?:${Object.values(versionEnvVarForCli).join("|")})\\b`,
);

function stepPinsVersion(step: WorkflowStep, cli: PreinstalledCli): boolean {
  const text = `${step.name ?? ""} ${step.run ?? ""}`.trim();
  return (
    new RegExp(`\\b${cli}\\b.*(?:==|=@|@\\d|version\\s+[0-9]|v[0-9]+\\.[0-9]+)`, "i").test(text) ||
    versionEnvVarPattern.test(text)
  );
}

function jobPinsVersion(job: WorkflowJob, installStepIndex: number, cli: PreinstalledCli): boolean {
  // check install step itself
  if (stepPinsVersion(job.steps[installStepIndex]!, cli)) {
    return true;
  }

  // check prior steps for version env var assignment
  for (let i = 0; i < installStepIndex; i++) {
    if (stepPinsVersion(job.steps[i]!, cli)) {
      return true;
    }
  }

  // check job-level env block
  const jobEnv = job.raw.env;
  if (jobEnv && typeof jobEnv === "object") {
    const versionVar = versionEnvVarForCli[cli];
    if (versionVar && versionVar in jobEnv) {
      return true;
    }
  }

  return false;
}

function getFirstInstallStep(job: WorkflowJob, cli: PreinstalledCli): WorkflowStep | undefined {
  const definition = preinstalledCliRules.find((entry) => entry.cli === cli);
  if (!definition) {
    return undefined;
  }

  return job.steps.find((step) => {
    const text = `${step.name ?? ""} ${step.run ?? ""}`.trim();
    return definition.installMatcher.test(text);
  });
}

function jobUsesCliAfterInstall(
  job: WorkflowJob,
  cli: PreinstalledCli,
  installStep: WorkflowStep,
): boolean {
  const definition = preinstalledCliRules.find((entry) => entry.cli === cli);
  if (!definition) {
    return false;
  }

  const installIndex = job.steps.indexOf(installStep);
  if (installIndex < 0) {
    return false;
  }

  return job.steps.slice(installIndex + 1).some((step) => {
    const text = `${step.name ?? ""} ${step.run ?? ""}`.trim();
    return definition.useMatcher.test(text);
  });
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
        if (!installStep || jobPinsVersion(job, job.steps.indexOf(installStep), cli)) {
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
