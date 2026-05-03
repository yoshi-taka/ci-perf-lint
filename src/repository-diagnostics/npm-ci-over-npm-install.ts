import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

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
  // Tokenize the command to check for flags after "npm install" or "npm i".
  // The previous exclusion regex was broken because .* greedily consumed
  // the prefix of each flag token, making every alternative unreachable.
  const tokens = trimmed.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] !== "install" && tokens[i] !== "i") {
      continue;
    }
    for (let j = i + 1; j < tokens.length; j++) {
      const token = tokens[j];
      if (token?.startsWith("-")) {
        return false;
      }
    }
  }
  return true;
}

function findNpmInstallSteps(workflow: WorkflowDocument): {
  jobId: string;
  stepIndex: number;
  run: string;
}[] {
  const results: { jobId: string; stepIndex: number; run: string }[] = [];

  for (const job of workflow.jobs) {
    if (job.usesReusableWorkflow) {
      continue;
    }
    for (let i = 0; i < job.steps.length; i++) {
      const step = job.steps[i];
      if (!step?.run) {
        continue;
      }
      if (isNpmInstallOnly(step.run)) {
        results.push({ jobId: job.id, stepIndex: i, run: step.run });
      }
    }
  }

  return results;
}

export async function collectNpmCiOverNpmInstallDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageLockPath = context.resolve("package-lock.json");

  if (!(await context.pathExists(packageLockPath))) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  for (const workflow of workflows) {
    const installSteps = findNpmInstallSteps(workflow);

    for (const { jobId, stepIndex } of installSteps) {
      const step = workflow.jobs.find((j) => j.id === jobId)?.steps[stepIndex];
      if (!step) {
        continue;
      }

      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
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
  }

  return diagnostics;
}
