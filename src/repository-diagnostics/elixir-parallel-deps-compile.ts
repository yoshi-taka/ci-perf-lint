import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import { isMap } from "../yaml.ts";
import { collectCommandEntries } from "../rules/shared/any-step.ts";
import { elixirHasParallelDepsCompile } from "../rules/shared/elixir-versions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-elixir-parallel-deps-compile",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-elixir-parallel-deps-compile.md",
} satisfies RuleMeta;

const PARTITION_ENV = "MIX_OS_DEPS_COMPILE_PARTITION_COUNT";
const MIX_COMPILE = /\bmix\s+(?:deps\.compile|compile)\b/i;

function circleCiHasElixirOrb(doc: CircleCiDocument): boolean {
  const orbs = doc.root?.get("orbs", true);
  if (isMap(orbs)) {
    for (const pair of orbs.items) {
      const value =
        (pair.value as { toJSON?: () => unknown } | undefined)?.toJSON?.() ?? pair.value;
      if (typeof value === "string" && /erlef\/|elixir|beam/i.test(value)) {
        return true;
      }
    }
  }
  return /orbs:[\s\S]*?(?:erlef\/|elixir|beam)/i.test(doc.source ?? "");
}

function circleCiOrbCompilesDeps(doc: CircleCiDocument): boolean {
  return doc.jobs.some((job) =>
    job.steps.some((step) => {
      const type = step.type;
      return /mix_get_and_compile_deps|\/compile\b/i.test(type) && /elixir|mix|beam/i.test(type);
    }),
  );
}

function configureParallelCompile(doc: CircleCiDocument): boolean {
  const count = new RegExp(`${PARTITION_ENV}\\s*[:=]\\s*(?:[2-9]|\\d{2,})`, "i");
  return count.test(doc.source ?? "");
}

async function toolVersionsLine(context: RepositoryDiagnosticContext): Promise<number> {
  const toolVersionsPath = context.scanContext.resolve(".tool-versions");
  if (!(await context.scanContext.pathExists(toolVersionsPath))) {
    return 1;
  }
  const text = (await context.scanContext.readTextFileOrWarn(toolVersionsPath)) ?? "";
  const index = text.split("\n").findIndex((line) => /^elixir\s+\S+/.test(line.trim()));
  return index >= 0 ? index + 1 : 1;
}

export async function collectElixirParallelDepsCompileDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const elixirVersion = context.repository.elixir.elixirVersion;
  if (!elixirVersion || !elixirHasParallelDepsCompile(elixirVersion)) {
    return [];
  }

  const circleDocs = (context.documents ?? []).filter(
    (doc): doc is CircleCiDocument => doc.kind === "circleci",
  );
  const orbDoc = circleDocs.find(circleCiHasElixirOrb);
  if (!orbDoc || circleDocs.some(configureParallelCompile)) {
    return [];
  }

  const compiles = circleDocs.some(
    (doc) =>
      circleCiOrbCompilesDeps(doc) ||
      collectCommandEntries(doc).some((entry) => MIX_COMPILE.test(entry.text)),
  );
  if (!compiles) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: ".tool-versions", line: await toolVersionsLine(context), column: 1 },
      message: `.tool-versions declares Elixir ${elixirVersion} but ${PARTITION_ENV} is not visible in the CircleCI Elixir orb compile path.`,
      why: "Elixir 1.19 can compile dependency graphs across multiple OS processes, which the Elixir team reports as up to 4x faster on dependency-heavy projects. The setting is opt-in. The CircleCI orb may configure it internally, so this is a prompt to verify rather than a confirmed miss.",
      suggestion: `If the orb does not already set ${PARTITION_ENV}, add it to the CircleCI job or workflow env (start with 4, roughly half the available cores).`,
      measurementHint:
        "Compare `mix deps.compile` wall-clock time with and without the variable, and watch runner memory as the count grows.",
      aiHandoff: `Inspect the CircleCI Elixir orb referenced by ${orbDoc.relativePath}. If it does not set ${PARTITION_ENV}, add the variable to the job env and re-run the compile step to confirm output is unchanged.`,
      score: 50,
    }),
  ];
}
