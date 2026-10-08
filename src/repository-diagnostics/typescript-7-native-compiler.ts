import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-typescript-7-native-compiler",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-typescript-7-native-compiler.md",
} satisfies RuleMeta;

export async function collectPreferTypeScript7NativeCompilerDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJsonText = packageJsonEntry.text ?? "";

  const { versionSpec, major } = repository.typescript;
  if (!versionSpec || major === undefined || major < 5 || major >= 7) {
    return [];
  }

  const keyMatch = /"typescript"\s*:/.exec(packageJsonText);
  const location = lineColumnForIndex(packageJsonText, keyMatch?.index ?? 0);

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: path.relative(repoRoot, packageJsonEntry.path),
        line: location.line,
        column: location.column,
      },
      message: `Repository is on TypeScript ${versionSpec}; the TypeScript 7 native compiler is available.`,
      why: "TypeScript 7 is a faithful Go port of the compiler that keeps the same type-checking logic as TypeScript 6.0 while adding native code speed and shared-memory parallelism. Microsoft reports 7x-12x faster full builds, up to 30x faster type checking, and roughly 3x lower memory use on production-scale codebases. Because the checker behavior matches 6.0, the migration is mostly a compiler swap rather than a language change; the main prerequisite is that the codebase already compiles cleanly under TypeScript 6.0 semantics.",
      suggestion:
        "If upgrading is feasible, move the TypeScript dependency to 7.x. When a tool still needs the programmatic compiler API, run TypeScript 6 and 7 side by side until the TypeScript 7.1 API ships.",
      measurementHint:
        "Compare full type-check and build wall-clock time, peak memory, and editor error latency before and after switching to the TypeScript 7 native compiler.",
      aiHandoff: `Upgrade TypeScript from ${versionSpec} to 7.x if compatibility allows. First confirm the repository compiles cleanly with TypeScript 6.0 semantics (stableTypeOrdering on, no ignoreDeprecations), then switch the \`typescript\` dependency to 7.x (the tsc binary). If typescript-eslint or another tool still needs the programmatic API, keep a TypeScript 6 alias and add the native package until the 7.1 API lands. Type-checker and builder parallelism are not auto-detected: \`--checkers\` defaults to a fixed 4, so set \`--checkers\`/\`--builders\` from the CI runner core count, or use \`--singleThreaded\` on memory-limited runners.`,
      score: 55,
    }),
  ];
}
