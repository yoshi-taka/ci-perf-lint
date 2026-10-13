import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobRunsOnStandardHostedRunner } from "./shared/workflow-jobs.ts";
import path from "node:path";
import {
  collectTestWorkerCommands,
  type TestTool,
  type TestWorkerCommand,
} from "./shared/test-worker-commands.ts";
import { workflowStepEnv, workflowWorkingDirectory } from "./shared/workflow-command-context.ts";

const meta = {
  id: "missing-test-worker-tuning-for-standard-runner",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-test-worker-tuning-for-standard-runner.md",
} satisfies RuleMeta;

const testToolWorkerTuningRules: readonly {
  tool: TestTool;
  examples: string;
}[] = [
  {
    tool: "jest",
    examples: "`--maxWorkers` or `--runInBand`",
  },
  {
    tool: "vitest",
    examples: "`--maxWorkers` or `--minWorkers`",
  },
  {
    tool: "playwright",
    examples: "`--workers`",
  },
  {
    tool: "pytest",
    examples: "`-n auto` or `--numprocesses`",
  },
];

function workerTuningExamples(tool: TestTool): string {
  return testToolWorkerTuningRules.find((rule) => rule.tool === tool)?.examples ?? "worker flags";
}

function hasApplicableConfig(command: TestWorkerCommand, context: RuleContext): boolean {
  if (command.configOverridden || command.config === null || command.directory === undefined) {
    return false;
  }
  const configs = context.repository.frameworks.testWorkerTuningConfigured[command.tool] ?? [];
  if (command.config !== undefined) {
    if (path.posix.isAbsolute(command.config)) {
      return false;
    }
    return configs.includes(
      path.posix.normalize(path.posix.join(command.directory, command.config)),
    );
  }
  // Root config evidence cannot prove tuning for a command in another package.
  return path.posix.normalize(command.directory) === "." && configs.length > 0;
}

function getUntunedTestStep(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  context: RuleContext,
): { step: WorkflowStep; tool: TestTool } | undefined {
  for (const step of job.steps) {
    for (const command of collectTestWorkerCommands(
      step.run ?? "",
      workflowStepEnv(workflow, job, step),
      workflowWorkingDirectory(workflow, job, step),
    )) {
      if (!command.tuned && !hasApplicableConfig(command, context)) {
        return { step, tool: command.tool };
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
