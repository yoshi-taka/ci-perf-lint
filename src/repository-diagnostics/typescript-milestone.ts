import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-next-typescript-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-next-typescript-performance-milestone.md",
} satisfies RuleMeta;

function getNextPerformanceMilestone(minor: number): 2 | 5 | 9 | undefined {
  if (minor < 2) {
    return 2;
  }

  if (minor < 5) {
    return 5;
  }

  if (minor < 9) {
    return 9;
  }

  return undefined;
}

function milestoneWhy(currentMinor: number, nextMinor: number): string {
  if (nextMinor === 2) {
    return `TypeScript 5.${currentMinor} is below the 5.2 performance milestone, where the compiler improved some heavy type relation checks. The TypeScript team reported over 33% speed-up on a drizzle case.`;
  }

  if (nextMinor === 5) {
    return `TypeScript 5.${currentMinor} is below the 5.5 performance milestone, where the language service and public TypeScript API got notable allocator and monomorphization improvements. The TypeScript team reported 5-8% build speed-ups through the public API and 10-20% faster language service operations.`;
  }

  return `TypeScript 5.${currentMinor} is below the 5.9 performance milestone. The TypeScript 5.9 release notes describe caching for repeated intermediate type instantiations in complex libraries such as Zod or tRPC-style code, and also mention file existence check improvements of around 11%. TypeScript 5.7 adds extra startup wins on Node 22 through compile caching.`;
}

function milestoneSuggestion(versionSpec: string, nextMinor: number): string {
  return nextMinor === 9
    ? `If upgrading is feasible, move TypeScript from ${versionSpec} to at least 5.9.x.`
    : `If upgrading is feasible, move TypeScript from ${versionSpec} to at least 5.${nextMinor}.x before aiming for 5.9.x as the longer-term target.`;
}

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

function findTypeScriptDependencyLocation(packageJsonText: string): {
  line: number;
  column: number;
} {
  const keyMatch = /"typescript"\s*:/.exec(packageJsonText);
  return lineColumnForIndex(packageJsonText, keyMatch?.index ?? 0);
}

export async function collectTypeScriptMilestoneDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJsonText = packageJsonEntry.text ?? "";

  const { versionSpec, major, minor, isPublishingTypeDefinitions } = repository.typescript;
  if (!versionSpec || major !== 5 || minor === undefined || isPublishingTypeDefinitions) {
    return [];
  }

  const nextMinor = getNextPerformanceMilestone(minor);
  if (!nextMinor) {
    return [];
  }

  const location = findTypeScriptDependencyLocation(packageJsonText);

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: path.relative(repoRoot, packageJsonEntry.path),
        line: location.line,
        column: location.column,
      },
      message: `Repository is on TypeScript ${versionSpec}, below the 5.${nextMinor} speed milestone.`,
      why: milestoneWhy(minor, nextMinor),
      suggestion: milestoneSuggestion(versionSpec, nextMinor),
      measurementHint:
        "Compare type-check, transpile, and editor-facing build times before and after upgrading TypeScript to the next milestone release.",
      aiHandoff: `Review the repository TypeScript version. If compatibility allows, upgrade TypeScript from ${versionSpec} to at least 5.${nextMinor === 9 ? "9" : nextMinor}.x${nextMinor === 9 ? "" : " as the next speed milestone, while keeping 5.9.x as the longer-term target"}.`,
      score: nextMinor === 9 ? 50 : 47,
    }),
  ];
}
