import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
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

const MIX_COMMAND = /\bmix\b/;

const NON_COMPILE_MIX_COMMAND =
  /\bmix\s+(?:local\.(?:hex|rebar)|archive\.install|deps\.(?:get|update|unlock|clean|tree|list|check)|hex\.|format|help|new)\b/;

export const preferElixirParallelDepsCompileRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    if (workflow.source?.includes(PARTITION_ENV)) {
      return [];
    }

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
        if (!MIX_COMMAND.test(run) || NON_COMPILE_MIX_COMMAND.test(run)) {
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
