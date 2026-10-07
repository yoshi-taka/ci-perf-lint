import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { versionSpecIsBelow } from "../repository-dependency-versions.ts";

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
    const { versionSpec, major, minor } = context.repository.jest;
    const { versionSpec: typescriptVersionSpec } = context.repository.typescript;
    const { jsdomVersionSpec, jsdomEnvironmentVersionSpec } = context.repository.jest;
    if (!versionSpec) {
      return [];
    }

    const fromJest29 =
      major === 29 &&
      typescriptMeetsJest30Minimum(context) &&
      jsdomMeetsJest30Compatibility(context);
    const fromJest30x =
      major === 30 &&
      minor !== undefined &&
      minor < 5 &&
      versionSpecIsBelow(versionSpec, [30, 5, 0]) === true;
    if (!fromJest29 && !fromJest30x) {
      return [];
    }

    return workflow.jobs
      .filter((job) => jobRunsJest(job))
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: fromJest29
            ? `Job "${job.id}" runs Jest while the repository is on Jest ${versionSpec}; TypeScript ${typescriptVersionSpec} and JSDOM compatibility evidence are already sufficient for a Jest 30.5 migration review.`
            : `Job "${job.id}" runs Jest on Jest ${versionSpec}, below the Jest 30.5 performance release.`,
          why: "Jest 30 is a high-value major for test performance because Jest's packages are bundled into fewer files, reducing module loading overhead, and Jest 30.5 is the notable 30.x performance release: warm module resolution cost drops to roughly a third, per-require overhead in jest-runtime is cut, jest-snapshot lazy-loads babel, semver and synckit so every test process loads about 200 fewer modules, and jest-haste-map stops spawning watchman on warm runs. For a Jest 29 upgrade, the official guide also sets the TypeScript floor at 5.4 and moves the jsdom environment to JSDOM 26.",
          suggestion:
            "Upgrade straight to at least 30.5.1. Run Oxlint `jest/no-alias-methods` first to rewrite removed matcher aliases, follow the Jest 30 upgrade guide for CLI, config, snapshot, and mock API changes, and avoid stopping at 30.5.0 (it had an ESM `#imports` subpath regression fixed in 30.5.1).",
          measurementHint:
            "Compare Jest wall-clock time, startup time, worker memory, and module-load-heavy test jobs before and after upgrading to Jest 30.5.1 or later.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade Jest from ${versionSpec} to at least 30.5.1 (not just 30.0). TypeScript is ${typescriptVersionSpec}; JSDOM evidence is ${jsdomVersionSpec ?? jsdomEnvironmentVersionSpec}. Before the upgrade, run or enable Oxlint \`jest/no-alias-methods\` to replace removed matcher aliases, then use https://jestjs.io/ja/docs/upgrading-to-jest30 for the migration checklist, and confirm the run is on 30.5.1 or later.`,
          score: fromJest29 ? 71 : 60,
        }),
      );
  },
};
