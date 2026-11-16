import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { findScientificPythonDependencyBelow } from "./python-scientific-dependencies.ts";

const meta = {
  id: "prefer-numpy-2-5",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-numpy-2-5.md",
} satisfies RuleMeta;

export async function collectPreferNumpy25Diagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const pin = await findScientificPythonDependencyBelow(context, "numpy", [2, 5, 0]);
  if (!pin) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: pin.fileName, line: pin.line, column: 1 },
      message: pin.resolved
        ? `${pin.fileName} resolves numpy ${pin.spec}, below NumPy 2.5.`
        : `${pin.fileName} allows numpy versions below 2.5 (${pin.spec}); raise the minimum version.`,
      why: "NumPy 2.5 adds faster reductions on small/medium contiguous arrays and batched searchsorted, relevant to numerical tests and fixture processing. Earlier 2.x releases improve sorting, strings, unique, scalar calculations and ndindex. Gains depend on operations, dtypes, array layout, hardware and build; this is not a measurement of total CI savings.",
      suggestion:
        "Require numpy >=2.5 and Python >=3.12, update old resolutions and compatible downstream packages, and check numerical, dtype and copy semantics. Keep intentional old-version compatibility coverage.",
      measurementHint:
        "Compare fixture construction, numerical test duration, peak memory, installation and total CI time. Verify numerical tolerances, dtypes and required ordering without weakening assertions. Keep BLAS threads and test-worker counts comparable.",
      aiHandoff: `Update ${pin.fileName}:${pin.line} to numpy >=2.5 and regenerate the existing lockfile. Use Python >=3.12 and check pandas/SciPy and other compiled dependencies for compatible wheels; rebuild local extensions for the NumPy 2 ABI when migrating from 1.x. Use Ruff NPY201 for supported API migrations, then review removed APIs, scalar type promotion/precision, Windows default integer width, copy=False behavior and unstable sort ordering. Preserve compatibility jobs and test intent; do not relax assertions merely to pass. Measure fixture setup, execution, memory and installation with comparable BLAS/test parallelism. Do not replace NumPy with JAX, CuPy or PyTorch solely because of its version: require workload and execution-environment evidence, including JIT warmup and device-transfer costs.`,
      score: 45,
    }),
  ];
}
