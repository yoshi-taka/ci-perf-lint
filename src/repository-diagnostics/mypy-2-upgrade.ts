import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { parseSemverLikeVersionSpec } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { detectInstalledMypyVersion } from "./mypy-version.ts";

const meta = {
  id: "consider-mypy-2-upgrade",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/consider-mypy-2-upgrade.md",
} satisfies RuleMeta;

export async function collectConsiderMypy2UpgradeDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  const detected = await detectInstalledMypyVersion(context);
  if (!detected) {
    return [];
  }

  const { major } = parseSemverLikeVersionSpec(detected.version);
  if (major === undefined || major >= 2) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: detected.fileName,
        line: detected.line + 1,
        column: 1,
      },
      message: `Repository is on mypy ${detected.version}; mypy 2.0 is a major release with significant speed gains.`,
      why: "mypy 2.0 adds parallel type checking (--num-workers, up to 5x with 8 workers), a native Rust parser, and fixed-format plus SQLite caches enabled by default. Despite the major version, the migration is usually light: the main changes are default flips (--local-partial-types, --strict-bytes, --allow-redefinition) that surface a few new errors, with escape hatches such as --allow-redefinition-old. Other changes are dropping support for targeting Python 3.9 and removing special casing of legacy bundled stubs.",
      suggestion:
        "Upgrade in a branch, run mypy, and fix or explicitly re-enable the changed defaults. Most projects need only a handful of adjustments.",
      measurementHint:
        "Compare type-check times before and after upgrading, and with and without --num-workers.",
      aiHandoff: `Review ${detected.fileName} and plan a mypy 2.x upgrade. Check the mypy 2.x release notes for breaking changes, then validate the CI type-check job.`,
      score: 35,
    }),
  ];
}
