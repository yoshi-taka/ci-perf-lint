import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectInstallCommand, detectLintToolFromText } from "./shared/tools.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";

const meta = {
  id: "unnecessary-app-install-for-lint-job",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/unnecessary-app-install-for-lint-job.md",
} satisfies RuleMeta;

const appConsumingPattern =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|test|dev|start|serve|preview|storybook)\b|\bgo\s+(?:build|test)\b|\btsc\b(?!\s+--version\b)|\bcargo\s+(?:build|test)\b|\brake\s+(?:build|test)\b|\bpytest\b|\bvitest\b|\bjest\b|\bava\b|\bvite\s+build\b|\bnext\s+build\b|\bturbo\s+run\s+build\b|\bmvn\b|\bgradle\b|\bdotnet\s+build\b/i;

export const unnecessaryAppInstallForLintJobRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const hasInstall = job.steps.some((step) =>
        ["npm", "pnpm", "yarn", "bun"].includes(detectInstallCommand(step) ?? ""),
      );
      if (!hasInstall) {
        continue;
      }

      const hasAppStep = job.steps.some(
        (step) =>
          appConsumingPattern.test(step.run ?? "") ||
          shellInvocations(step.run ?? "").some(
            ([tool, action]) =>
              /^(?:\$|`)/.test(tool ?? "") ||
              (tool === "cargo" && action !== "fmt") ||
              /^(?:cross|napi|node-gyp)$/.test(tool ?? ""),
          ),
      );
      if (hasAppStep) {
        continue;
      }

      const lintStep = job.steps.find((step) =>
        shellInvocations(step.run ?? "").some(([tool]) => detectLintToolFromText("", tool ?? "")),
      );
      if (!lintStep) {
        continue;
      }

      const lintTool = shellInvocations(lintStep.run ?? "")
        .map(([tool]) => detectLintToolFromText("", tool ?? ""))
        .find(Boolean);

      // Stricter condition: eslint and prettier often need project-specific plugins,
      // parsers, or sharable configs that must be resolved from node_modules.
      if (lintTool === "eslint" && context.repository.eslint.hasConfig) {
        continue;
      }
      if (lintTool === "prettier" && context.repository.prettier.pluginNames.length > 0) {
        continue;
      }

      const firstInstallStep = job.steps.find((step) =>
        ["npm", "pnpm", "yarn", "bun"].includes(detectInstallCommand(step) ?? ""),
      )!;
      findings.push(
        buildDiagnostic(workflow, meta, firstInstallStep.runNode ?? firstInstallStep.node, {
          message: `Job "${job.id}" installs application dependencies but only runs check or lint steps.`,
          why: "Installing full application dependencies adds dependency resolution, lockfile processing, and disk write time for a job that does not build, test, or serve the application. Standalone lint tools can often run via npx/pnpm dlx without the full dependency tree.",
          suggestion:
            "Replace the install step with npx/pnpm dlx for the lint tool directly, or install only the minimum packages needed for linting via a separate workflow or targeted install.",
          measurementHint:
            "Compare the total job duration before and after removing the install step. If the lint tool is available via npx/pnpx, the step overhead drops from tens of seconds to near zero.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath}: it installs application dependencies but only runs linting. Consider using npx or pnpm dlx instead to skip the full dependency install.`,
          score: 68,
        }),
      );
    }

    return findings;
  },
};
