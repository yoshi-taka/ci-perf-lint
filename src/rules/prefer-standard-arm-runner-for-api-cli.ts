import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasUnresolvedRunnerExecution } from "./shared/runner-execution-context.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";
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

function findApiCliTool(job: WorkflowJob): string | undefined {
  const candidates: [string, RegExp][] = [
    ["Terraform", /\bterraform\s+(?:init|plan|apply|destroy)\b/],
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

  return candidates.find(([, pattern]) =>
    job.steps.some((step) =>
      shellInvocations(step.run ?? "").some(
        (words) => pattern.exec(words.join(" ").toLowerCase())?.index === 0,
      ),
    ),
  )?.[0];
}

function hasArchitectureSensitiveWork(job: WorkflowJob): boolean {
  return job.steps.some(
    (step) =>
      /^docker\/(?:build-push-action|setup-qemu-action)@/i.test(step.uses ?? "") ||
      shellInvocations(step.run ?? "").some((words) =>
        /^(?:docker\s+build\b|(?:cargo|go)\s+(?:build|test)\b|(?:mvn|gradle|electron|tauri|make|cmake|node-gyp|playwright|cypress)\b)/i.test(
          words.slice(0, 2).join(" "),
        ),
      ),
  );
}

export const preferStandardArmRunnerForApiCliRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (
        !jobRunsOnStandardX64Ubuntu(job) ||
        jobRunsOnArmLikeRunner(job) ||
        jobRunsInContainer(job) ||
        jobHasUnresolvedRunnerExecution(workflow, job)
      ) {
        continue;
      }

      const apiTool = findApiCliTool(job);
      if (!apiTool) {
        continue;
      }

      const severity = hasArchitectureSensitiveWork(job) ? "suggestion" : "warning";
      const armLabel = suggestedStandardArmUbuntuRunner(job);
      const armTarget = armLabel
        ? `\`${armLabel}\``
        : "the standard arm64 Ubuntu runner matching this job's image";

      findings.push(
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          severity,
          message: `Job "${job.id}" runs ${apiTool} API-bound CLI work on a standard x64 Ubuntu runner.`,
          why: `${apiTool} jobs often spend time in provider API calls or CLI orchestration rather than CPU-bound local work. These CLIs commonly run on arm64, so the matching standard GitHub-hosted arm64 Ubuntu runner can be a practical runner choice when every action and install path in the job supports arm64.`,
          suggestion: `Test this API-bound CLI job on ${armTarget} and keep the switch if the provider CLIs, setup actions, credentials flow, and command behavior stay compatible.`,
          measurementHint:
            "Compare wall-clock duration, setup time, and failure rate across several runs before and after changing the runner label.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and test whether its ${apiTool} CLI path can run on ${armTarget}. Verify all third-party actions and CLI installs support arm64 before changing the default runner.`,
          score: severity === "warning" ? 52 : 36,
        }),
      );
    }
    return findings;
  },
};
