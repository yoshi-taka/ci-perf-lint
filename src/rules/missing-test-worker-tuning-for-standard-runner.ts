import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobRunsOnStandardHostedRunner } from "./shared/workflow-jobs.ts";
import path from "node:path";
import { shellCommandSegments } from "./shared/command-patterns.ts";

const meta = {
  id: "missing-test-worker-tuning-for-standard-runner",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-test-worker-tuning-for-standard-runner.md",
} satisfies RuleMeta;

type TestTool = "jest" | "vitest" | "playwright" | "pytest";

const testToolWorkerTuningRules: readonly {
  tool: TestTool;
  detectionMatcher: RegExp;
  tuningMatcher: RegExp;
  examples: string;
}[] = [
  {
    tool: "jest",
    detectionMatcher: /^(?:(?:npx|bunx|pnpm exec|yarn exec)\s+)?jest(?:\s|$)/i,
    tuningMatcher: /--maxWorkers(?:=|\s)\S+|--runInBand\b/i,
    examples: "`--maxWorkers` or `--runInBand`",
  },
  {
    tool: "vitest",
    detectionMatcher: /^(?:(?:npx|bunx|pnpm exec|yarn exec)\s+)?vitest(?:\s|$)/i,
    tuningMatcher: /--maxWorkers(?:=|\s)\S+|--minWorkers(?:=|\s)\S+|--pool(?:=|\s)\S+/i,
    examples: "`--maxWorkers` or `--minWorkers`",
  },
  {
    tool: "playwright",
    detectionMatcher: /^(?:(?:npx|bunx|pnpm exec|yarn exec)\s+)?playwright\s+test\b/i,
    tuningMatcher: /(?:^|\s)--workers(?:=|\s)\S+/i,
    examples: "`--workers`",
  },
  {
    tool: "pytest",
    detectionMatcher: /^(?:(?:python|python3)\s+-m\s+|uv run\s+)?pytest(?:\s|$)/i,
    tuningMatcher: /\s-n\s*(?:auto|\d+)\b|\s--numprocesses(?:=|\s)(?:auto|\d+)/i,
    examples: "`-n auto` or `--numprocesses`",
  },
];

function detectDirectTestTool(command: string): TestTool | undefined {
  return testToolWorkerTuningRules.find((rule) => rule.detectionMatcher.test(command))?.tool;
}

function hasVisibleWorkerTuning(step: WorkflowStep, tool: TestTool): boolean {
  const run = step.run ?? "";
  return testToolWorkerTuningRules.some(
    (rule) => rule.tool === tool && rule.tuningMatcher.test(run),
  );
}

function workerTuningExamples(tool: TestTool): string {
  return testToolWorkerTuningRules.find((rule) => rule.tool === tool)?.examples ?? "worker flags";
}

function defaultWorkingDirectory(raw: Record<string, unknown> | undefined): string | undefined {
  const defaults = raw?.defaults;
  if (!defaults || typeof defaults !== "object" || !("run" in defaults)) {
    return undefined;
  }
  const run = defaults.run;
  if (!run || typeof run !== "object" || !("working-directory" in run)) {
    return undefined;
  }
  return typeof run["working-directory"] === "string" ? run["working-directory"] : undefined;
}

function hasApplicableConfig(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
  tool: TestTool,
  context: RuleContext,
): boolean {
  const configs = context.repository.frameworks.testWorkerTuningConfigured[tool] ?? [];
  const cwd =
    step.workingDirectory ??
    defaultWorkingDirectory(job.raw) ??
    defaultWorkingDirectory(workflow.parsed) ??
    ".";
  const config = /(?:^|\s)(?:--config|-c)(?:=|\s+)["']?([^\s"']+)/.exec(step.run ?? "");
  if (config?.[1]) {
    return configs.includes(path.posix.normalize(path.posix.join(cwd, config[1])));
  }
  // Root config evidence cannot prove tuning for a command in another package.
  return path.posix.normalize(cwd) === "." && configs.length > 0;
}

function getUntunedTestStep(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  context: RuleContext,
): { step: WorkflowStep; tool: TestTool } | undefined {
  for (const step of job.steps) {
    for (const command of shellCommandSegments(step.run ?? "")) {
      const tool = detectDirectTestTool(command);
      if (!tool) {
        continue;
      }
      const commandStep = { ...step, run: command };
      if (
        !hasVisibleWorkerTuning(commandStep, tool) &&
        !hasApplicableConfig(workflow, job, commandStep, tool, context)
      ) {
        return { step, tool };
      }
    }
  }

  return undefined;
}

export const missingTestWorkerTuningForStandardRunnerRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (!jobRunsOnStandardHostedRunner(job) || job.usesReusableWorkflow) {
        continue;
      }

      const untuned = getUntunedTestStep(workflow, job, context);
      if (!untuned) {
        continue;
      }

      const examples = workerTuningExamples(untuned.tool);

      findings.push(
        buildDiagnostic(workflow, meta, untuned.step.runNode ?? untuned.step.node, {
          message: `Job "${job.id}" runs ${untuned.tool} on a standard GitHub-hosted runner without visible worker tuning.`,
          why: "Standard GitHub-hosted runners have known CPU limits, so explicitly tuning test worker count can make runtime and contention behavior easier to reason about than relying on defaults alone.",
          suggestion: `If this test path is performance-sensitive, consider making worker tuning explicit for ${untuned.tool}, for example with ${examples}.`,
          measurementHint:
            "Compare total runtime and test stability before and after making worker count explicit on the same runner label.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}", confirm the current ${untuned.tool} default parallelism on the standard hosted runner label, and only add explicit worker tuning if it improves runtime or stability for this test path.`,
          score: 31,
        }),
      );
    }
    return findings;
  },
};
