import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import {
  detectBuildTool,
  detectInstallCommand,
  detectLintTool,
  detectRedundantBootstrapTool,
} from "./shared/tools.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getSetupActionKind } from "./shared/workflow-setup-actions.ts";
import { hasSetupBunStep, hasSetupPnpmStep } from "./shared/workflow-analysis.ts";

const lightweightToolingMatcher =
  /\b(prettier|oxfmt|eslint|oxlint|biome|markdownlint|markdownlint-cli2?|cspell|actionlint|shellcheck|yamllint|commitlint|textlint|check|verify|quality|repo-health|static-analysis)\b/i;
const nonLightweightNodeWorkMatcher =
  /\b(vitest|jest|playwright|cypress|e2e|integration|test|typecheck|tsc|build|compile|bundle|webpack|rollup|esbuild|vite\s+build|next\s+build|nuxt\s+build|storybook|release|deploy|publish)\b/i;

// Sources:
// - https://bun.sh/docs/installation
// - https://bun.sh/docs/cli/bunx
// - https://github.com/oven-sh/setup-bun
const meta = {
  id: "prefer-setup-bun-for-lightweight-node-tooling",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-setup-bun-for-lightweight-node-tooling.md",
} satisfies RuleMeta;

function stepLooksLightweightTooling(step: WorkflowStep): boolean {
  const text = `${step.name ?? ""} ${step.run ?? ""}`.trim();
  return (
    Boolean(detectLintTool(step)) ||
    Boolean(detectRedundantBootstrapTool(step)) ||
    lightweightToolingMatcher.test(text)
  );
}

function stepLooksNonLightweightNodeWork(step: WorkflowStep): boolean {
  const text = `${step.name ?? ""} ${step.run ?? ""}`.trim();
  return Boolean(detectBuildTool(step)) || nonLightweightNodeWorkMatcher.test(text);
}

function jobUsesNodeSetup(job: WorkflowJob): boolean {
  return job.steps.some((step) => getSetupActionKind(step) === "node");
}

function jobRunsNx(job: WorkflowJob): boolean {
  return job.steps.some((step) =>
    /\bnx\s+(?:affected\b|run-many\b|run\b|graph\b|show\b)/i.test(
      `${step.name ?? ""} ${step.run ?? ""}`,
    ),
  );
}

function jobLooksLikeLightweightNodeTooling(job: WorkflowJob): boolean {
  const hasToolingSignals = job.steps.some((step) => stepLooksLightweightTooling(step));
  const hasNonLightweightSignals = job.steps.some((step) => stepLooksNonLightweightNodeWork(step));
  return hasToolingSignals && !hasNonLightweightSignals;
}

function getNodePackageManager(job: WorkflowJob): "npm" | "yarn" | "pnpm" | "bun" | undefined {
  for (const step of job.steps) {
    const install = detectInstallCommand(step);
    if (install === "npm" || install === "yarn" || install === "pnpm" || install === "bun") {
      return install;
    }
  }

  return undefined;
}

export const preferSetupBunForLightweightNodeToolingRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      if (!jobUsesNodeSetup(job) || hasSetupBunStep(job) || hasSetupPnpmStep(job)) {
        return [];
      }

      if (jobRunsNx(job)) {
        return [];
      }

      if (!jobLooksLikeLightweightNodeTooling(job)) {
        return [];
      }

      const packageManager = getNodePackageManager(job);
      if (packageManager === "bun" || packageManager === "pnpm") {
        return [];
      }

      const packageManagerText = packageManager ? `${packageManager}-based` : "node-based";
      const anchorStep =
        job.steps.find((step) => stepLooksLightweightTooling(step)) ??
        job.steps.find((step) => getSetupActionKind(step) === "node");
      if (!anchorStep) {
        return [];
      }

      return [
        buildDiagnostic(
          workflow,
          meta,
          anchorStep.runNode ?? anchorStep.usesNode ?? anchorStep.node,
          {
            message: `Job "${job.id}" looks like a lightweight ${packageManagerText} tooling path and does not use setup-bun.`,
            why: "For lint, format, docs, and similar non-product Node tooling jobs, Bun can reduce setup and command startup overhead compared with a plain setup-node plus npm/yarn path.",
            suggestion:
              "If this job only runs lightweight tooling and does not rely on npm/yarn-specific behavior, consider switching the job to oven-sh/setup-bun and bun or bunx.",
            measurementHint:
              "Compare total job duration after replacing setup-node plus npm/yarn-based lightweight tooling commands with setup-bun plus bun or bunx.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and, if it only runs lightweight repository tooling, test replacing setup-node and npm/yarn-based commands with setup-bun and Bun equivalents without changing actual coverage.`,
            score: 52,
          },
        ),
      ];
    });
  },
};
