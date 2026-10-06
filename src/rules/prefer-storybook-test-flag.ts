import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "prefer-storybook-test-flag",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-storybook-test-flag.md",
} satisfies RuleMeta;

const storybookBuildPattern = /\b(?:build-storybook|storybook\s+build)\b/i;
const scriptInvocationPattern =
  /\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?[\w:.-]*(?:build-storybook|storybook)\b/i;
const testFlagPattern = /(?:^|\s)--test(?:\s|$)/;
const storybookTestPattern =
  /\b(?:test-storybook|storybook\s+test|@storybook\/test-runner|chromatic|chromaui\/action|chromatic-com\/storybook)\b/i;
const sbTestBuildEnvPattern = /\bSB_TESTBUILD\b\s*[:=]\s*["']?(?:true|1|yes)["']?/i;

function stepText(step: WorkflowStep): string {
  return `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""}`;
}

function isDirectStorybookBuildWithoutTestFlag(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  if (!storybookBuildPattern.test(run) || scriptInvocationPattern.test(run)) {
    return false;
  }
  return !testFlagPattern.test(run);
}

function jobBuildsStorybookForTests(job: WorkflowJob): boolean {
  const buildsWithoutTestFlag = job.steps.some(isDirectStorybookBuildWithoutTestFlag);
  if (!buildsWithoutTestFlag) {
    return false;
  }
  return job.steps.some((step) => storybookTestPattern.test(stepText(step)));
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

    if (sbTestBuildEnvPattern.test(workflow.source ?? "")) {
      return [];
    }

    return workflow.jobs
      .filter((job) => !job.usesReusableWorkflow && jobBuildsStorybookForTests(job))
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
