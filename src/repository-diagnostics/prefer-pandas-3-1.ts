import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { findScientificPythonDependencyBelow } from "./python-scientific-dependencies.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-pandas-3-1",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-pandas-3-1.md",
} satisfies RuleMeta;

export async function collectPreferPandas31Diagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  // Legacy requirements get the migration-choice rule, not a duplicate upgrade.
  if (await findScientificPythonDependencyBelow(context, "pandas", [2, 0, 0])) {
    return [];
  }
  const pin = await findScientificPythonDependencyBelow(context, "pandas", [3, 1, 0]);
  if (!pin) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: pin.fileName, line: pin.line, column: 1 },
      message: pin.resolved
        ? `${pin.fileName} resolves pandas ${pin.spec}, below pandas 3.1.`
        : `${pin.fileName} allows pandas versions below 3.1 (${pin.spec}); raise the minimum version.`,
      why: "pandas 3.0 makes Copy-on-Write and dedicated string dtype the default; 3.1 improves sorted-key groupby, Arrow reductions/casts, dtype access, concat/merge and rolling. pandas 2.2 also accelerated dataframe/series equality assertions. Actual test and memory gains depend on operations and configuration.",
      suggestion:
        "Require pandas >=3.1 and Python >=3.11, update resolved versions, and migrate removed APIs, chained assignments, copy/view assumptions and string dtype expectations.",
      measurementHint:
        "Compare fixture setup, dataframe assertions, processing test duration and peak memory before and after upgrading; verify equivalent values and intentional dtype/mutation behavior.",
      aiHandoff: `Update ${pin.fileName}:${pin.line} to pandas >=3.1 and regenerate the existing lockfile. Use Python >=3.11 and compatible NumPy/downstream packages. When migrating from 2.x, resolve warnings on 2.3 and test Copy-on-Write and new string dtype before upgrading. Replace chained assignment with .loc, review read-only arrays and removed APIs, and update tests only for intentional semantic changes. Preserve compatibility jobs and do not weaken assertions. Measure test setup, execution and memory.`,
      score: 45,
    }),
  ];
}
