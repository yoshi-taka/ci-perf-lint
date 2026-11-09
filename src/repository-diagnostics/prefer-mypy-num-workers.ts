import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { parseSemverLikeVersionSpec } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { detectInstalledMypyVersion } from "./mypy-version.ts";
import { shellCommandSegments, shellCommands } from "../rules/shared/command-patterns.ts";
import { effectiveStepEnvironment } from "../rules/shared/workflow-env.ts";
import { toolInvocations, invocationOptions } from "../rules/shared/tool-command-evidence.ts";
import { shellExecutionTexts } from "../rules/shared/shell-execution-text.ts";
import {
  declaredShellEnvironmentValues,
  declaredShellEnvironmentNames,
  githubEnvironmentValues,
} from "../rules/shared/shell-environment-evidence.ts";

const meta = {
  id: "prefer-mypy-num-workers",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-mypy-num-workers.md",
} satisfies RuleMeta;

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
      const persisted: Record<string, string> = {};
      for (const step of job.steps) {
        const run = step.run ?? "";
        const env = { ...persisted, ...effectiveStepEnvironment(workflow, job, step) };
        const untuned = shellExecutionTexts(run).some((source) => {
          let workerEnv = env.MYPY_NUM_WORKERS;
          return shellCommandSegments(source).some((command) => {
            const bindings = declaredShellEnvironmentValues(command);
            const inlineWorkers =
              bindings.MYPY_NUM_WORKERS ??
              (declaredShellEnvironmentNames(command).has("MYPY_NUM_WORKERS")
                ? "$__unknown_environment__"
                : undefined);
            const raw = shellCommands(command)[0] ?? [];
            if (
              ["export", "readonly"].includes(raw[0] ?? "") ||
              raw.every((word) => /^[A-Za-z_]\w*=/.test(word))
            ) {
              workerEnv = inlineWorkers ?? workerEnv;
            }
            return toolInvocations(command).some((words) => {
              if (words[0] !== "mypy") {
                return false;
              }
              const flags = invocationOptions(words, [
                "--num-workers",
                "-n",
                "--follow-imports",
                "--cache-dir",
                "--exclude",
                "--module",
                "-m",
                "--package",
                "--python-executable",
                "--python-version",
                "--custom-typeshed-dir",
                "--config-file",
                "--junit-xml",
                "--txt-report",
                "--html-report",
                "--linecount-report",
                "--json-report",
              ]);
              if (flags.some(({ name }) => ["--help", "-h", "--version", "-V"].includes(name))) {
                return false;
              }
              const flag = flags
                .filter(({ name }) => ["--num-workers", "-n"].includes(name))
                .at(-1);
              const value = flag ? flag.value : (inlineWorkers ?? workerEnv);
              if (typeof value === "string" && /[$`]|__shell_substitution__/.test(value)) {
                return false;
              }
              return value !== undefined ? !parallelValue(value, supportsAuto) : !configured;
            });
          });
        });
        Object.assign(persisted, githubEnvironmentValues(run));
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
