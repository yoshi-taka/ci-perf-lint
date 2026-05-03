import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

// Sources:
// - https://jestjs.io/ja/docs/upgrading-to-jest30
// - https://oxc.rs/docs/guide/usage/linter/rules/jest/no-alias-methods
const meta = {
  id: "prefer-jest-30-for-jest-29",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-jest-30-for-jest-29.md",
} satisfies RuleMeta;

function stepText(step: WorkflowStep): string {
  return `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""}`;
}

function jobRunsJest(job: WorkflowJob): boolean {
  return job.steps.some((step) =>
    /\b(?:jest|npm\s+test|npm\s+run\s+test|pnpm\s+test|pnpm\s+run\s+test|yarn\s+test|bun\s+test)\b/i.test(
      stepText(step),
    ),
  );
}

function typescriptMeetsJest30Minimum(context: RuleContext): boolean {
  const { major, minor } = context.repository.typescript;
  return major !== undefined && (major > 5 || (major === 5 && minor !== undefined && minor >= 4));
}

function jsdomMeetsJest30Compatibility(context: RuleContext): boolean {
  const { jsdomMajor, jsdomEnvironmentMajor } = context.repository.jest;
  return (
    (jsdomMajor !== undefined && jsdomMajor >= 26) ||
    (jsdomEnvironmentMajor !== undefined && jsdomEnvironmentMajor >= 30)
  );
}

export const preferJest30ForJest29Rule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { versionSpec, major } = context.repository.jest;
    const { versionSpec: typescriptVersionSpec } = context.repository.typescript;
    const { jsdomVersionSpec, jsdomEnvironmentVersionSpec } = context.repository.jest;
    if (
      !versionSpec ||
      major !== 29 ||
      !typescriptMeetsJest30Minimum(context) ||
      !jsdomMeetsJest30Compatibility(context)
    ) {
      return [];
    }

    return workflow.jobs
      .filter((job) => jobRunsJest(job))
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs Jest while the repository is on Jest ${versionSpec}; TypeScript ${typescriptVersionSpec} and JSDOM compatibility evidence are already sufficient for a Jest 30 migration review.`,
          why: "Jest 30 is a high-value major for test performance because Jest's packages are bundled into fewer files, reducing module loading overhead. The official upgrade guide also sets the TypeScript floor at 5.4 and moves the jsdom environment to JSDOM 26, both of which this repository already appears ready for.",
          suggestion:
            "Plan a Jest 29 to 30 upgrade, run Oxlint `jest/no-alias-methods` first to rewrite removed matcher aliases, then follow the Jest 30 upgrade guide for CLI, config, snapshot, and mock API changes.",
          measurementHint:
            "Compare Jest wall-clock time, startup time, worker memory, and module-load-heavy test jobs before and after upgrading to Jest 30.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade Jest from ${versionSpec} to 30.x if compatibility checks pass. TypeScript is ${typescriptVersionSpec}; JSDOM evidence is ${jsdomVersionSpec ?? jsdomEnvironmentVersionSpec}. Before the upgrade, run or enable Oxlint \`jest/no-alias-methods\` to replace removed matcher aliases, then use https://jestjs.io/ja/docs/upgrading-to-jest30 for the migration checklist.`,
          score: 71,
        }),
      );
  },
};
