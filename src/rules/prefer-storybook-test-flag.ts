import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectStorybookCommands } from "./shared/storybook-commands.ts";
import { workflowStepEnv } from "./shared/workflow-command-context.ts";

const meta = {
  id: "prefer-storybook-test-flag",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-storybook-test-flag.md",
} satisfies RuleMeta;

function jobBuildsStorybookForTests(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  let untunedBuild = false;
  let testConsumer = false;
  for (const step of job.steps) {
    const commands = collectStorybookCommands(step.run ?? "", workflowStepEnv(workflow, job, step));
    untunedBuild ||= commands.builds.includes(false);
    testConsumer ||=
      commands.testConsumer ||
      /^(?:chromaui\/action|chromatic-com\/storybook)@/.test(step.uses ?? "");
  }
  return untunedBuild && testConsumer;
}

export const preferStorybookTestFlagRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { storybookVersionSpec, storybookMajor, storybookMinor } = context.repository.frameworks;
    if (!storybookVersionSpec || storybookMajor === undefined || storybookMinor === undefined) {
      return [];
    }

    const testFlagAvailable = storybookMajor > 7 || (storybookMajor === 7 && storybookMinor >= 6);
    if (!testFlagAvailable) {
      return [];
    }

    return workflow.jobs
      .filter((job) => !job.usesReusableWorkflow && jobBuildsStorybookForTests(workflow, job))
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" builds Storybook for tests without the --test flag.`,
          why: "Storybook 7.6+ supports a test build mode (`--test`, or `SB_TESTBUILD=true`) that skips docs, docgen, and sourcemaps. Storybook measured test builds 2-4x faster with it and the output is smaller. It is safe for builds consumed by the Storybook Test Runner or Chromatic that do not need docs.",
          suggestion:
            "Add --test to the Storybook build command (or set SB_TESTBUILD=true) when the build is only used for tests, not for publishing.",
          measurementHint:
            "Compare build-storybook wall-clock time and output size with and without --test.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}". If this Storybook build only feeds the Storybook Test Runner or Chromatic and does not need docs, add --test to the build command (or set SB_TESTBUILD=true). Do not add --test to a build that is published with docs.`,
          score: 55,
        }),
      );
  },
};
