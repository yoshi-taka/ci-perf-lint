import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import {
  circleCiElixirOrbCompilesDeps,
  circleCiHasElixirOrbEvidence,
} from "../circleci-elixir-evidence.ts";
import { collectCommandEntries } from "../rules/shared/any-step.ts";
import { parseMakefile, type ParsedMakefile } from "../rules/shared/makefile-parser.ts";
import { elixirHasParallelDepsCompile } from "../rules/shared/elixir-versions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-elixir-parallel-deps-compile",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-elixir-parallel-deps-compile.md",
} satisfies RuleMeta;

const PARTITION_ENV = "MIX_OS_DEPS_COMPILE_PARTITION_COUNT";
const MIX_COMPILE = /\bmix\s+(?:deps\.compile|compile|test|release)\b/i;
const MAKE_TARGET = /\bmake\s+([A-Za-z0-9_.:-]+)/g;

function configureParallelCompile(doc: CircleCiDocument): boolean {
  const count = new RegExp(`${PARTITION_ENV}\\s*[:=]\\s*(?:[2-9]|\\d{2,})`, "i");
  return count.test(doc.source ?? "");
}

async function loadMakefile(
  context: RepositoryDiagnosticContext,
): Promise<ParsedMakefile | undefined> {
  for (const name of ["Makefile", "makefile", "GNUmakefile"]) {
    const filePath = context.scanContext.resolve(name);
    if (!(await context.scanContext.pathExists(filePath))) {
      continue;
    }
    const text = await context.scanContext.readTextFileOrWarn(filePath);
    if (text) {
      return parseMakefile(text);
    }
  }
  return undefined;
}

function makeTargetCompiles(
  makefile: ParsedMakefile,
  target: string,
  seen: Set<string>,
  depth = 0,
): boolean {
  if (depth > 4 || seen.has(target)) {
    return false;
  }
  seen.add(target);

  const recipe = makefile.targets.get(target) ?? "";
  if (MIX_COMPILE.test(recipe)) {
    return true;
  }
  for (const prerequisite of makefile.prereqs.get(target) ?? []) {
    if (makeTargetCompiles(makefile, prerequisite, seen, depth + 1)) {
      return true;
    }
  }
  for (const match of recipe.matchAll(MAKE_TARGET)) {
    if (makeTargetCompiles(makefile, match[1]!, seen, depth + 1)) {
      return true;
    }
  }
  return false;
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
  const orbDoc = circleDocs.find(circleCiHasElixirOrbEvidence);
  if (!orbDoc || circleDocs.some(configureParallelCompile)) {
    return [];
  }

  const makefile = await loadMakefile(context);
  const entryCompiles = (text: string): boolean => {
    if (MIX_COMPILE.test(text)) {
      return true;
    }
    if (!makefile) {
      return false;
    }
    for (const match of text.matchAll(MAKE_TARGET)) {
      if (makeTargetCompiles(makefile, match[1]!, new Set())) {
        return true;
      }
    }
    return false;
  };

  const compiles = circleDocs.some(
    (doc) =>
      circleCiElixirOrbCompilesDeps(doc) ||
      collectCommandEntries(doc).some((entry) => entryCompiles(entry.text)),
  );
  if (!compiles) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: ".tool-versions", line: await toolVersionsLine(context), column: 1 },
      message: `.tool-versions declares Elixir ${elixirVersion} but ${PARTITION_ENV} is not visible in the CircleCI Elixir compile path.`,
      why: "Elixir 1.19 can compile dependency graphs across multiple OS processes, which the Elixir team reports as up to 4x faster on dependency-heavy projects. The setting is opt-in. The CircleCI orb may configure it internally, so this is a prompt to verify rather than a confirmed miss.",
      suggestion: `If the orb does not already set ${PARTITION_ENV}, add it to the CircleCI job or workflow env (start with 4, roughly half the available cores).`,
      measurementHint:
        "Compare `mix deps.compile` wall-clock time with and without the variable, and watch runner memory as the count grows.",
      aiHandoff: `Inspect the CircleCI Elixir orb referenced by ${orbDoc.relativePath}. If it does not set ${PARTITION_ENV}, add the variable to the job env and re-run the compile step to confirm output is unchanged.`,
      score: 50,
    }),
  ];
}
