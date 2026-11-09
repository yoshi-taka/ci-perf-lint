import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { shellCommandSegments, shellCommands } from "./shared/command-patterns.ts";
import { shellExecutionTexts } from "./shared/shell-execution-text.ts";
import { shellNonDisplayInvocations } from "./shared/shell-invocations.ts";
import {
  declaredShellEnvironmentValues,
  declaredShellEnvironmentNames,
} from "./shared/shell-environment-evidence.ts";
import { effectiveStepEnvironment } from "./shared/workflow-env.ts";
import {
  detectElixirContainer,
  detectSetupBeam,
  elixirHasParallelDepsCompile,
} from "./shared/elixir-versions.ts";

const meta = {
  id: "prefer-elixir-parallel-deps-compile",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-elixir-parallel-deps-compile.md",
} satisfies RuleMeta;

const PARTITION_ENV = "MIX_OS_DEPS_COMPILE_PARTITION_COUNT";

const NON_COMPILE_MIX_COMMAND =
  /^(?:local\.(?:hex|rebar)|archive\.install|deps\.(?:get|update|unlock|clean|tree|list|check)|hex\.[\w.]+|format|help|new)$/;

function stepCompilesWithoutParallel(run: string, envValue: unknown): boolean {
  for (const source of shellExecutionTexts(run)) {
    let partitionCount = Number(envValue);
    for (const command of shellCommandSegments(source)) {
      const declared = declaredShellEnvironmentValues(command);
      const count = declaredShellEnvironmentNames(command).has(PARTITION_ENV)
        ? Number(declared[PARTITION_ENV])
        : partitionCount;
      const raw = shellCommands(command)[0] ?? [];
      if (
        ["export", "readonly"].includes(raw[0] ?? "") ||
        raw.every((word) => /^[A-Za-z_]\w*=/.test(word))
      ) {
        partitionCount = count;
      }
      if (
        shellNonDisplayInvocations(command).some(
          ([tool, task]) =>
            tool === "mix" && task && !task.startsWith("-") && !NON_COMPILE_MIX_COMMAND.test(task),
        ) &&
        !(count > 1)
      ) {
        return true;
      }
    }
  }
  return false;
}

export const preferElixirParallelDepsCompileRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: ReturnType<typeof buildDiagnostic>[] = [];

    for (const job of workflow.jobs) {
      const setupBeam = detectSetupBeam(job);
      const container = detectElixirContainer(job);

      const elixirVersion =
        setupBeam?.elixirVersion ??
        (container ? container.image.replace(/^elixir:/i, "") : undefined);

      if (!elixirVersion || !elixirHasParallelDepsCompile(elixirVersion)) {
        continue;
      }

      for (const step of job.steps) {
        const run = step.run ?? "";
        const env = effectiveStepEnvironment(workflow, job, step);
        if (!stepCompilesWithoutParallel(run, env[PARTITION_ENV])) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
            message: `Job "${job.id}" compiles dependencies with Elixir ${elixirVersion} without ${PARTITION_ENV}.`,
            why: "Elixir 1.19 can compile dependency graphs across multiple OS processes, which the Elixir team reports as up to 4x faster on dependency-heavy projects. Parallel dependency compilation is opt-in: without the environment variable Mix still compiles dependencies sequentially.",
            suggestion: `Set ${PARTITION_ENV} to a number greater than 1 in the job or workflow env (for example ${PARTITION_ENV}: 4, roughly half the number of cores).`,
            measurementHint:
              "Compare `mix deps.compile` wall-clock time with and without the variable; increase the count until it stops improving.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and set ${PARTITION_ENV} in env (start with 4). Watch memory usage on the runner, then re-run the job to confirm compile results are unchanged.`,
            score: 50,
          }),
        );
        break;
      }
    }

    return findings;
  },
};
