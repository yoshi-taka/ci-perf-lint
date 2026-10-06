import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { parseSemverLikeVersionSpec } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { detectInstalledMypyVersion } from "./mypy-version.ts";
import { shellCommandSegments } from "../rules/shared/command-patterns.ts";
import { effectiveStepEnvironment } from "../rules/shared/workflow-env.ts";

const meta = {
  id: "prefer-mypy-num-workers",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-mypy-num-workers.md",
} satisfies RuleMeta;

const INSTALL_COMMAND = /\b(?:pip|pip3|pipx|uv|poetry|pipenv)\s+(?:install|add|sync)\b/;

const NON_CHECK_COMMAND = /(?:--version|--help)\b/;

const PARALLEL_FLAG = /(?:^|\s)(?:--num-workers(?:=|\s+)|-n(?:=|\s+)?)(auto|\d+)(?=\s|$)/g;

function parallelValue(value: unknown, supportsAuto: boolean): boolean {
  return (supportsAuto && value === "auto") || /^[1-9]\d*$/.test(String(value));
}

async function configEnablesParallel(
  context: RepositoryScanContext,
  supportsAuto: boolean,
): Promise<boolean> {
  for (const fileName of ["mypy.ini", ".mypy.ini", "pyproject.toml", "setup.cfg"]) {
    if (!(await context.pathExists(context.resolve(fileName)))) {
      continue;
    }
    const text = await context.readTextFileOrWarn(context.resolve(fileName));
    let inMypy = false;
    let hasMypy = false;
    for (const line of (text ?? "").split("\n")) {
      const section = /^\s*\[([^\]]+)\]/.exec(line);
      if (section) {
        inMypy = section[1] === "mypy" || section[1] === "tool.mypy";
        hasMypy ||= inMypy;
      }
      const value = inMypy ? /^\s*num_workers\s*=\s*["']?(auto|\d+)\b/.exec(line)?.[1] : undefined;
      if (value !== undefined) {
        return parallelValue(value, supportsAuto);
      }
    }
    if (hasMypy) {
      return false;
    }
  }
  return false;
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

  const { major, minor } = parseSemverLikeVersionSpec(detected.version);
  if (major === undefined || major < 2) {
    return [];
  }

  const supportsAuto = major > 2 || (minor ?? 0) >= 4;
  const configured = await configEnablesParallel(context, supportsAuto);

  const diagnostics: Diagnostic[] = [];

  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        const env = effectiveStepEnvironment(workflow, job, step);
        let workerEnv = env.MYPY_NUM_WORKERS;
        const untuned = shellCommandSegments(run).some((command) => {
          const inlineEnv = /\bMYPY_NUM_WORKERS=["']?(auto|\d+)\b/.exec(command)?.[1];
          if (
            inlineEnv !== undefined &&
            (/^export\s+/.test(command) || /^MYPY_NUM_WORKERS=\S+$/.test(command))
          ) {
            workerEnv = inlineEnv;
          }
          if (
            !/\bmypy\b/.test(command) ||
            INSTALL_COMMAND.test(command) ||
            NON_CHECK_COMMAND.test(command)
          ) {
            return false;
          }
          const flag = [...command.matchAll(PARALLEL_FLAG)].at(-1)?.[1];
          if (flag !== undefined) {
            return !parallelValue(flag, supportsAuto);
          }
          const value = inlineEnv ?? workerEnv;
          return value !== undefined ? !parallelValue(value, supportsAuto) : !configured;
        });
        if (!untuned) {
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
            suggestion: supportsAuto
              ? 'Add --num-workers auto (or a fixed count such as 8) to the mypy command. Alternatively, set num_workers = auto in mypy.ini/setup.cfg, or num_workers = "auto" in pyproject.toml [tool.mypy].'
              : "Add --num-workers with a fixed integer (for example, --num-workers 8), or set num_workers = 8 in the mypy configuration. Automatic worker selection requires mypy 2.4 or later.",
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
