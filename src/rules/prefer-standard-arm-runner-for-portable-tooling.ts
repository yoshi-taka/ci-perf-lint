import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getWorkflowStepText } from "./shared/workflow-step-text.ts";
import {
  jobRunsOnArmLikeRunner,
  jobRunsOnStandardX64Ubuntu,
  suggestedStandardArmUbuntuRunner,
} from "./shared/standard-arm-runners.ts";

const meta = {
  id: "prefer-standard-arm-runner-for-portable-tooling",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-standard-arm-runner-for-portable-tooling.md",
} satisfies RuleMeta;

const portableToolMatchers: [string, RegExp][] = [
  ["Oxlint", /(?:^|\s)(?:bunx\s+|pnpm\s+exec\s+|yarn\s+|npx\s+)?oxlint(?:\s|$)/i],
  ["Oxfmt", /(?:^|\s)(?:bunx\s+|pnpm\s+exec\s+|yarn\s+|npx\s+)?oxfmt(?:\s|$)/i],
  ["Ruff", /(?:^|\s)(?:(?:python|python3)\s+-m\s+|uvx\s+)?ruff(?:\s|$)/i],
  ["Biome", /(?:^|\s)(?:bunx\s+|pnpm\s+exec\s+|yarn\s+|npx\s+)?(?:biome|@biomejs\/biome)(?:\s|$)/i],
  [
    "actionlint",
    /(?:^|\s)(?:bunx\s+|pnpm\s+exec\s+|yarn\s+|npx\s+)?actionlint(?:\s|$)|--actionlint(?:\s|$)/i,
  ],
  [
    "ShellCheck",
    /(?:^|\s)(?:bunx\s+|pnpm\s+exec\s+|yarn\s+|npx\s+)?shellcheck(?:\s|$)|--shellcheck(?:\s|$)/i,
  ],
  ["yamllint", /(?:^|\s)(?:uvx\s+|pipx\s+run\s+)?yamllint(?:\s|$)|--yamllint(?:\s|$)/i],
  [
    "markdownlint",
    /(?:^|\s)(?:bunx\s+|pnpm\s+exec\s+|yarn\s+|npx\s+)?(?:markdownlint|markdownlint-cli2?)(?:\s|$)/i,
  ],
  ["cspell", /(?:^|\s)(?:bunx\s+|pnpm\s+exec\s+|yarn\s+|npx\s+)?cspell(?:\s|$)/i],
];

const architectureSensitiveWorkPattern =
  /(docker\s+build|docker\/build-push-action@|docker\/setup-qemu-action@|cargo\s+(?:build|test)|go\s+(?:build|test)|mvn\s|gradle\s|electron|tauri|make\s|cmake|native module|node-gyp|playwright|cypress|vitest|jest|pytest|tsc|typecheck|next\s+build|vite\s+build|webpack|rollup)/i;

function jobRunsInContainer(job: WorkflowJob): boolean {
  return Boolean(job.raw.container);
}

function getStepText(step: WorkflowStep): string {
  return getWorkflowStepText(step);
}

function analyzePortableToolingJob(job: WorkflowJob): {
  portableTool?: { name: string; step: WorkflowStep };
  hasArchitectureSensitiveWork: boolean;
} {
  let portableTool: { name: string; step: WorkflowStep } | undefined;
  let hasArchitectureSensitiveWork = false;

  for (const step of job.steps) {
    const text = getStepText(step);

    if (!hasArchitectureSensitiveWork && architectureSensitiveWorkPattern.test(text)) {
      hasArchitectureSensitiveWork = true;
    }

    if (!portableTool) {
      const match = portableToolMatchers.find(([, pattern]) => pattern.test(text));
      if (match) {
        portableTool = { name: match[0], step };
      }
    }

    if (portableTool && hasArchitectureSensitiveWork) {
      break;
    }
  }

  return {
    portableTool,
    hasArchitectureSensitiveWork,
  };
}

export const preferStandardArmRunnerForPortableToolingRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (
        !jobRunsOnStandardX64Ubuntu(job) ||
        jobRunsOnArmLikeRunner(job) ||
        jobRunsInContainer(job)
      ) {
        continue;
      }

      const analysis = analyzePortableToolingJob(job);
      if (analysis.hasArchitectureSensitiveWork) {
        continue;
      }

      const portableTool = analysis.portableTool;
      if (!portableTool) {
        continue;
      }

      const armRunner = suggestedStandardArmUbuntuRunner(job);

      findings.push(
        buildDiagnostic(workflow, meta, portableTool.step.runNode ?? portableTool.step.node, {
          message: `Job "${job.id}" is lightweight, architecture-portable tooling on a standard x64 Ubuntu runner (detected: ${portableTool.name}).`,
          why: `${portableTool.name} is only the portability signal; the recommendation is about the runner. This job looks like lint/format tooling without visible native builds, browser tests, typechecking, or containers, so it is a reasonable candidate for the matching standard GitHub-hosted arm64 Ubuntu runner. For short portable jobs, many runs are still rounded to a whole billable minute, so switching eligible work off standard x64 can improve cost or runner efficiency, but only if installs, caches, and output stay compatible on arm64.`,
          suggestion: `Test changing this job's runner label to \`${armRunner}\`; keep the switch only if the same tooling command installs cleanly, reuses caches as expected, and produces equivalent output.`,
          measurementHint:
            "Compare wall-clock duration, billed runner time, setup/cache time, and failure rate across several runs before and after changing only the runner label.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and test whether this lightweight portable tooling path can run on ${armRunner}. Treat ${portableTool.name} as the compatibility signal, not as the optimization itself; verify install/cache behavior and output before changing the default runner.`,
          score: 50,
        }),
      );
    }
    return findings;
  },
};
