import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { parseSemverLikeVersionSpec } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { detectInstalledMypyVersion } from "./mypy-version.ts";

const meta = {
  id: "prefer-mypy-num-workers",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-mypy-num-workers.md",
} satisfies RuleMeta;

const INSTALL_COMMAND = /\b(?:pip|pip3|pipx|uv|poetry|pipenv)\s+(?:install|add|sync)\b/;

const NON_CHECK_COMMAND = /(?:--version|--help)\b/;

const PARALLEL_FLAG =
  /(?:--num-workers(?:=|\s+)(?:auto|[1-9]\d*)|\s-n(?:=|\s+)?(?:auto|[1-9]\d*)(?:\s|$))/;

const NUM_WORKERS_SETTING = /\bnum_workers\s*=\s*(?:auto|[1-9]\d*)\b/i;

const MYPY_NUM_WORKERS_ENV = /MYPY_NUM_WORKERS\s*[=:]\s*["']?(?:auto|[1-9]\d*)\b/;

async function configEnablesParallel(context: RepositoryScanContext): Promise<boolean> {
  for (const fileName of ["mypy.ini", ".mypy.ini", "pyproject.toml", "setup.cfg"]) {
    const text = await context.readTextFileOrWarn(context.resolve(fileName));
    if (text && NUM_WORKERS_SETTING.test(text)) {
      return true;
    }
  }
  return false;
}

function workflowEnablesParallel(workflows: WorkflowDocument[]): boolean {
  return workflows.some(
    (workflow) => workflow.source !== undefined && MYPY_NUM_WORKERS_ENV.test(workflow.source),
  );
}

export async function collectPreferMypyNumWorkersDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  const detected = await detectInstalledMypyVersion(context);
  if (!detected) {
    return [];
  }

  const { major } = parseSemverLikeVersionSpec(detected.version);
  if (major === undefined || major < 2) {
    return [];
  }

  if ((await configEnablesParallel(context)) || workflowEnablesParallel(workflows)) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        if (
          !/\bmypy\b/.test(run) ||
          INSTALL_COMMAND.test(run) ||
          NON_CHECK_COMMAND.test(run) ||
          PARALLEL_FLAG.test(run)
        ) {
          continue;
        }

        diagnostics.push(
          buildRepositoryDiagnostic(repository, meta, {
            location: {
              path: workflow.relativePath,
              line: 1,
              column: 1,
            },
            message: `mypy ${detected.version} is installed, but this CI command runs mypy without parallel workers.`,
            why: "mypy 2.0 supports experimental parallel type checking. With --num-workers mypy type-checks independent module groups in separate processes and has shown up to 5x speedups with 8 workers on large projects. Parallel checking is opt-in (default is 0, i.e. disabled), so upgrading alone does not capture the speedup.",
            suggestion:
              "Add --num-workers to the mypy command (for example, --num-workers 8 or --num-workers auto), or set num_workers = auto in mypy.ini, pyproject.toml [tool.mypy], or setup.cfg [mypy].",
            measurementHint:
              "Compare mypy wall-clock time with and without --num-workers. Tune the worker count from 3-4 upward; more workers than physical CPU cores is not beneficial.",
            aiHandoff: `Review ${workflow.relativePath} and add --num-workers to the mypy command (or set num_workers in the mypy configuration). Verify no report generation is combined with parallel mode, then re-run the job to confirm type-check results are unchanged.`,
            score: 55,
          }),
        );
      }
    }
  }

  return diagnostics;
}
