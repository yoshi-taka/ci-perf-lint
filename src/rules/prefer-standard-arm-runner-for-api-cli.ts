import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  jobRunsOnArmLikeRunner,
  jobRunsOnStandardX64Ubuntu,
  suggestedStandardArmUbuntuRunner,
} from "./shared/standard-arm-runners.ts";

const meta = {
  id: "prefer-standard-arm-runner-for-api-cli",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-standard-arm-runner-for-api-cli.md",
} satisfies RuleMeta;

function jobRunsInContainer(job: WorkflowJob): boolean {
  return Boolean(job.raw.container);
}

const jobTextCache = new WeakMap<WorkflowJob, string>();

function getJobText(job: WorkflowJob): string {
  const cached = jobTextCache.get(job);
  if (cached !== undefined) {
    return cached;
  }

  const text = job.steps
    .map((step) => `${step.name ?? ""} ${step.uses ?? ""} ${step.run ?? ""}`)
    .join("\n")
    .toLowerCase();
  jobTextCache.set(job, text);
  return text;
}

function findApiCliTool(job: WorkflowJob): string | undefined {
  const text = getJobText(job);
  const candidates: [string, RegExp][] = [
    ["Terraform", /\bterraform\s+(?:init|plan|apply|destroy|validate|fmt|providers|workspace)\b/],
    [
      "AWS CDK",
      /\b(?:npx\s+)?cdk\s+(?:synth|diff|deploy|destroy|bootstrap)\b|\baws-cdk\s+(?:synth|diff|deploy|destroy|bootstrap)\b/,
    ],
    ["Pulumi", /\bpulumi\s+(?:preview|up|destroy|refresh|stack|config)\b/],
    [
      "CloudFormation",
      /\baws\s+cloudformation\s+(?:deploy|validate-template|create-stack|update-stack|delete-stack|describe-stacks|create-change-set|execute-change-set)\b/,
    ],
    ["AWS SAM", /\bsam\s+(?:validate|build|package|deploy|delete)\b/],
    [
      "Serverless Framework",
      /\bserverless\s+(?:package|deploy|remove|info)\b|\bsls\s+(?:package|deploy|remove|info)\b/,
    ],
    ["SST", /\bsst\s+(?:deploy|diff|remove|refresh|bind)\b/],
    [
      "Kubernetes",
      /\bkubectl\s+(?:apply|diff|rollout|set\s+image|get|describe|wait|delete|scale)\b/,
    ],
    ["Helm", /\bhelm\s+(?:template|lint|diff|upgrade|install|uninstall|status|list)\b/],
  ];

  return candidates.find(([, pattern]) => pattern.test(text))?.[0];
}

function hasArchitectureSensitiveWork(job: WorkflowJob): boolean {
  const text = getJobText(job);
  return /(docker\s+build|docker\/build-push-action@|docker\/setup-qemu-action@|cargo\s+(?:build|test)|go\s+(?:build|test)|mvn\s|gradle\s|electron|tauri|make\s|cmake|native module|node-gyp|playwright|cypress)/.test(
    text,
  );
}

export const preferStandardArmRunnerForApiCliRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      if (
        !jobRunsOnStandardX64Ubuntu(job) ||
        jobRunsOnArmLikeRunner(job) ||
        jobRunsInContainer(job)
      ) {
        return [];
      }

      const apiTool = findApiCliTool(job);
      if (!apiTool) {
        return [];
      }

      const severity = hasArchitectureSensitiveWork(job) ? "suggestion" : "warning";
      const armRunner = suggestedStandardArmUbuntuRunner(job);

      return [
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          severity,
          message: `Job "${job.id}" runs ${apiTool} API-bound CLI work on a standard x64 Ubuntu runner.`,
          why: `${apiTool} jobs often spend time in provider API calls or CLI orchestration rather than CPU-bound local work. These CLIs commonly run on arm64, so the matching standard GitHub-hosted arm64 Ubuntu runner can be a practical runner choice when every action and install path in the job supports arm64.`,
          suggestion: `Test this API-bound CLI job on \`${armRunner}\` and keep the switch if the provider CLIs, setup actions, credentials flow, and command behavior stay compatible.`,
          measurementHint:
            "Compare wall-clock duration, setup time, and failure rate across several runs before and after changing the runner label.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and test whether its ${apiTool} CLI path can run on ${armRunner}. Verify all third-party actions and CLI installs support arm64 before changing the default runner.`,
          score: severity === "warning" ? 52 : 36,
        }),
      ];
    });
  },
};
