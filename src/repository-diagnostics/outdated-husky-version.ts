import type { Diagnostic, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  outdatedHuskyVersionMeta as meta,
  isAtOrBelowHusky911,
  outdatedHuskyMessage,
  outdatedHuskySuggestion,
  outdatedHuskyMeasurementHint,
  outdatedHuskyScore,
} from "../rules/shared/husky-versions.ts";

export function collectOutdatedHuskyVersionDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
): Diagnostic[] {
  const { versionSpec, major, minor, patch, versionLocation, hookFileCount } = repository.husky;
  if (!versionSpec || !isAtOrBelowHusky911(major, minor, patch)) {
    return [];
  }

  if (hookFileCount === 0) {
    return [];
  }

  const location: SourceLocation = versionLocation ?? { path: "package.json", line: 1, column: 1 };
  const normalizedPath = location.path;

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: normalizedPath, line: location.line, column: location.column },
      message: outdatedHuskyMessage(versionSpec),
      why: "Husky 9.1.1 has known issues. Older setups also tend to keep deprecated bootstrap patterns and extra hook startup overhead.",
      suggestion: outdatedHuskySuggestion,
      measurementHint: outdatedHuskyMeasurementHint,
      aiHandoff: `Review the repository Husky setup at ${normalizedPath}:${location.line}:${location.column}. This finding surfaced while scanning ${repository.primaryWorkflowPath}. Upgrade Husky from ${versionSpec} to the latest v9 release if compatibility allows, and keep hook behavior unchanged while modernizing the bootstrap path.`,
      score: outdatedHuskyScore(major),
    }),
  ];
}
