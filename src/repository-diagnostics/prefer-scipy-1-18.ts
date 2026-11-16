import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { findScientificPythonDependencyBelow } from "./python-scientific-dependencies.ts";

const meta = {
  id: "prefer-scipy-1-18",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-scipy-1-18.md",
} satisfies RuleMeta;

export async function collectPreferScipy118Diagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const pin = await findScientificPythonDependencyBelow(context, "scipy", [1, 18, 0]);
  if (!pin) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: pin.fileName, line: pin.line, column: 1 },
      message: pin.resolved
        ? `${pin.fileName} resolves scipy ${pin.spec}, below SciPy 1.18.`
        : `${pin.fileName} allows scipy versions below 1.18 (${pin.spec}); raise the minimum version.`,
      why: "SciPy 1.18 moves batching loops for QR, eigenvalue, least-squares and SVD routines into compiled code, improves other linear algebra operations and reduces cached FFT plan memory. Earlier milestones improve sparse solves, statistics, imports and batched operations. Benefits depend on the functions, inputs and BLAS/LAPACK backend; a version alone does not prove slow tests or total CI savings.",
      suggestion:
        "Require scipy >=1.18, Python >=3.12 and NumPy >=2.0, update compatible dependencies and regenerate the lockfile. Review removed APIs, result shapes/dtypes and numerical behavior while preserving intentional compatibility coverage.",
      measurementHint:
        "Compare imports, fixture setup, numerical test duration, peak memory, installation and total CI time with comparable hardware, BLAS backend/thread counts and test workers. Validate residuals, convergence and dtypes with justified rtol/atol; do not widen tolerances merely to pass.",
      aiHandoff: `Prepare a dependency update for ${pin.fileName}:${pin.line} to scipy >=1.18, Python >=3.12 and NumPy >=2.0, then regenerate the existing lockfile and verify compatible wheels/downstream packages. Keep intentional older-version compatibility jobs. Resolve deprecations and removed APIs, and review batched shapes, sparse array versus matrix semantics, result dtypes and RNG behavior. NumPy 1-to-2 migration also needs ABI and scalar type-promotion checks. Numerical results may change with algorithm, BLAS/LAPACK, CPU or threading changes: compare known solutions, residuals, convergence and high-precision references where appropriate. Distinguish rounding differences, accuracy fixes, intentional behavior changes and regressions; do not weaken assertions or widen rtol/atol merely to pass. Measure imports, setup, execution and memory under comparable conditions. New APIs such as vectorized optimization need explicit code changes; do not assume upgrading enables them.`,
      score: 45,
    }),
  ];
}
