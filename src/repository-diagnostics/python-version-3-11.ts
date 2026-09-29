import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  preferPython311MeasurementHint,
  preferPython311Meta as meta,
  preferPython311Suggestion,
  preferPython311Why,
} from "../rules/shared/python-versions.ts";

export function collectPythonVersion311Diagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
  _scanContext?: RepositoryScanContext,
): Diagnostic[] {
  const occurrence = repository.python.versionOccurrences[0];
  if (!occurrence) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: occurrence.path, line: occurrence.line, column: 1 },
      message: `Repository targets Python below 3.11 (${occurrence.versionSpec}) in ${occurrence.path}.`,
      why: preferPython311Why,
      suggestion: preferPython311Suggestion,
      measurementHint: preferPython311MeasurementHint,
      aiHandoff: `Review ${occurrence.path} at ${occurrence.line}:1 and move the Python version to at least 3.11. Update .python-version, setup-python version inputs, tox/nox basepython, and requires-python together, then confirm tests still pass.`,
      score: 52,
    }),
  ];
}
