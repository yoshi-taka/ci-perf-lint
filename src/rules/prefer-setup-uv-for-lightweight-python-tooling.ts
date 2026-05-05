import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { detectInstallCommand, detectPythonTool } from "./shared/tools.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getSetupActionKind } from "./shared/workflow-setup-actions.ts";
import { hasSetupUvStep } from "./shared/workflow-analysis.ts";

const lightweightPythonToolingMatcher =
  /\b(ruff|black|isort|flake8|pylint|bandit|yamllint|markdownlint|codespell|textlint|sphinx-build|check|verify|quality|repo-health|static-analysis)\b/i;
const nonLightweightPythonWorkMatcher =
  /\b(pytest|tox|nox|test|build|compile|package|publish|release|deploy)\b/i;

// Sources:
// - https://docs.astral.sh/uv/guides/integration/github/
// - https://github.com/astral-sh/setup-uv
const meta = {
  id: "prefer-setup-uv-for-lightweight-python-tooling",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-setup-uv-for-lightweight-python-tooling.md",
} satisfies RuleMeta;

function stepLooksLightweightPythonTooling(step: WorkflowStep): boolean {
  const text = `${step.name ?? ""} ${step.run ?? ""}`.trim();
  return Boolean(detectPythonTool(step)) || lightweightPythonToolingMatcher.test(text);
}

function stepLooksNonLightweightPythonWork(step: WorkflowStep): boolean {
  const text = `${step.name ?? ""} ${step.run ?? ""}`.trim();
  return nonLightweightPythonWorkMatcher.test(text);
}

function jobUsesPythonSetup(job: WorkflowJob): boolean {
  return job.steps.some((step) => getSetupActionKind(step) === "python");
}

function jobLooksLikeLightweightPythonTooling(job: WorkflowJob): boolean {
  const hasToolingSignals = job.steps.some((step) => stepLooksLightweightPythonTooling(step));
  const hasNonLightweightSignals = job.steps.some((step) =>
    stepLooksNonLightweightPythonWork(step),
  );
  return hasToolingSignals && !hasNonLightweightSignals;
}

function getPythonPackageManager(job: WorkflowJob): "pip" | "pipenv" | "poetry" | "uv" | undefined {
  for (const step of job.steps) {
    const install = detectInstallCommand(step);
    if (install === "pip" || install === "pipenv" || install === "poetry" || install === "uv") {
      return install;
    }
  }

  return undefined;
}

export const preferSetupUvForLightweightPythonToolingRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (!jobUsesPythonSetup(job) || hasSetupUvStep(job)) {
        continue;
      }

      if (!jobLooksLikeLightweightPythonTooling(job)) {
        continue;
      }

      const packageManager = getPythonPackageManager(job);
      if (packageManager === "uv") {
        continue;
      }

      const packageManagerText = packageManager ? `${packageManager}-based` : "python-based";
      const anchorStep =
        job.steps.find((step) => stepLooksLightweightPythonTooling(step)) ??
        job.steps.find((step) => getSetupActionKind(step) === "python");
      if (!anchorStep) {
        continue;
      }

      findings.push(
        buildDiagnostic(
          workflow,
          meta,
          anchorStep.runNode ?? anchorStep.usesNode ?? anchorStep.node,
          {
            message: `Job "${job.id}" looks like a lightweight ${packageManagerText} tooling path and does not use setup-uv.`,
            why: "For lint, format, docs, and similar non-product Python tooling jobs, uv can reduce setup and command startup overhead compared with a plain setup-python plus pip/poetry/pipenv path.",
            suggestion:
              "If this job only runs lightweight tooling and does not rely on pip/poetry/pipenv-specific behavior, consider switching the job to astral-sh/setup-uv and uv-based commands.",
            measurementHint:
              "Compare total job duration after replacing setup-python plus lightweight pip/poetry/pipenv commands with setup-uv plus uv-based equivalents.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and, if it only runs lightweight repository tooling, test replacing setup-python and pip/poetry/pipenv-based commands with setup-uv and uv equivalents without changing actual coverage.`,
            score: 51,
          },
        ),
      );
    }
    return findings;
  },
};
