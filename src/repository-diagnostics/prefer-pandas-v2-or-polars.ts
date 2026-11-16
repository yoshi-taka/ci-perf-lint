import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { findScientificPythonDependencyBelow } from "./python-scientific-dependencies.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

// Retain the published ID for existing suppressions and report consumers.
const meta = {
  id: "prefer-pandas-v2-or-polars",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-pandas-v2-or-polars.md",
} satisfies RuleMeta;

export async function collectPreferPandasV2OrPolarsDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const pin = await findScientificPythonDependencyBelow(context, "pandas", [2, 0, 0]);
  if (!pin) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: pin.fileName, line: pin.line, column: 1 },
      message: pin.resolved
        ? `${pin.fileName} resolves pandas ${pin.spec}, below pandas 2.`
        : `${pin.fileName} allows pandas versions below 2 (${pin.spec}); raise the minimum version.`,
      why: "Legacy pandas 0.x/1.x misses faster equality assertions introduced in 2.2, default Copy-on-Write and string dtype in 3.0, and groupby, Arrow, concat/merge and rolling improvements in 3.1. Polars 2.1 is an alternative with parallel lazy execution and improved streaming memory management. Benefits depend on the workload, not just the version.",
      suggestion:
        "Require pandas >=3.1 and update old resolutions, or migrate suitable dataframe processing to Polars >=2.1. Both require Python >=3.11. Preserve dtype, index, missing-value, ordering, and mutation semantics, and retain intentional old-version compatibility coverage.",
      measurementHint:
        "Compare fixture setup, equality assertions, data-processing tests, peak memory, installation, and total CI time. Verify equivalent results without weakening assertions; Arrow-backed pandas strings require PyArrow.",
      aiHandoff: `Review ${pin.fileName}:${pin.line}; choose pandas >=3.1 or Polars >=2.1 and regenerate the existing lockfile. Update Python to >=3.11 and check NumPy and downstream dependencies. Keep deliberate pandas 0/1 compatibility jobs. For pandas, use 2.3 as a migration checkpoint if useful, resolve deprecations, replace chained assignment with .loc, and review Copy-on-Write, string dtype and read-only arrays. For Polars, rewrite APIs explicitly and check null/index semantics, lazy execution and row ordering. Preserve test intent and assertions; measure setup, test execution and memory separately.`,
      score: 45,
    }),
  ];
}
