import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { findDataframeDependencyBelow } from "./dataframe-dependencies.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-polars-2-1",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-polars-2-1.md",
} satisfies RuleMeta;

export async function collectPreferPolars21Diagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const pin = await findDataframeDependencyBelow(context, "polars", [2, 1, 0]);
  if (!pin) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: pin.fileName, line: pin.line, column: 1 },
      message: pin.resolved
        ? `${pin.fileName} resolves polars ${pin.spec}, below Polars 2.1.`
        : `${pin.fileName} allows polars versions below 2.1 (${pin.spec}); raise the minimum version.`,
      why: "Polars 2.0 defaults lazy collection to the streaming engine and adds query optimizations and initial spill-to-disk support. 2.1 adds streaming out-of-core groupby, better spill-memory budgeting and lower-memory dataframe construction. Eager operations remain in-memory, and neither every query nor every CI test benefits.",
      suggestion:
        "Require polars >=2.1 and Python >=3.11, update old resolutions, and review dtype, row-order and I/O behavior changes.",
      measurementHint:
        "Compare fixture construction, lazy query/test duration, peak memory and spill I/O on representative CI data. Verify values and explicit ordering without assuming every operation can spill.",
      aiHandoff: `Update ${pin.fileName}:${pin.line} to polars >=2.1, use Python >=3.11 and regenerate the existing lockfile. Follow the version migration guides, preserving compatibility jobs and test intent. Review stricter dtypes, null handling, and lazy joins/groupby/unpivot row ordering; sort explicitly or use supported maintain_order options where required. Eager operations do not automatically become streaming. Check buffer seek(0) on I/O round trips. Measure fixture construction, execution, memory and spill I/O without weakening assertions.`,
      score: 45,
    }),
  ];
}
