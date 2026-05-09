import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";

const meta = {
  id: "npm-ci-over-npm-install",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/npm-ci-over-npm-install.md",
} satisfies RuleMeta;

const npmInstallWithoutOptionsPattern =
  /\bnpm\s+install\b(?!\s+(?:--package-lock-only|--dry-run|--help|-h\b|--version|-V\b))/i;

function isNpmInstallOnly(run: string): boolean {
  const trimmed = run.trim();
  if (!npmInstallWithoutOptionsPattern.test(trimmed)) {
    return false;
  }
  const tokens = trimmed.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] !== "install" && tokens[i] !== "i") {
      continue;
    }
    for (let j = i + 1; j < tokens.length; j++) {
      return false;
    }
  }
  return true;
}

function findNpmInstallSteps(
  context: RepositoryDiagnosticContext,
): { workflow: WorkflowDocument; jobId: string; stepIndex: number; run: string }[] {
  const results: { workflow: WorkflowDocument; jobId: string; stepIndex: number; run: string }[] =
    [];

  for (const { workflow, job, step } of context.predicateIndex.allSteps) {
    if (job.usesReusableWorkflow) {
      continue;
    }
    if (!step.run) {
      continue;
    }
    if (isNpmInstallOnly(step.run)) {
      const stepIndex = job.steps.indexOf(step);
      results.push({ workflow, jobId: job.id, stepIndex, run: step.run });
    }
  }

  return results;
}

export async function collectNpmCiOverNpmInstallDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const packageLockPath = context.scanContext.resolve("package-lock.json");

  if (!(await context.scanContext.pathExists(packageLockPath))) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const installSteps = findNpmInstallSteps(context);

  for (const { workflow, jobId, stepIndex } of installSteps) {
    const step = workflow.jobs.find((j) => j.id === jobId)?.steps[stepIndex];
    if (!step) {
      continue;
    }

    diagnostics.push(
      buildRepositoryDiagnostic(context.repository, meta, {
        location: {
          path: workflow.relativePath,
          line: 1,
          column: 1,
        },
        message: `Job "${jobId}" uses "npm install" instead of "npm ci" in ${workflow.relativePath}.`,
        why: "npm ci is faster and deterministic for CI because it installs exactly what is in package-lock.json without modifying it. npm install may update the lock file and re-resolve dependencies, adding unnecessary overhead.",
        suggestion:
          'Replace "npm install" with "npm ci" in CI workflows when package-lock.json exists.',
        measurementHint:
          "Compare total job duration before and after switching from npm install to npm ci.",
        aiHandoff: `Review ${workflow.relativePath} job "${jobId}" and replace "npm install" with "npm ci" while preserving unrelated behavior.`,
        score: 60,
      }),
    );
  }

  return diagnostics;
}
