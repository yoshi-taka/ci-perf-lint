import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { collectSourceAudit } from "./source-audit.ts";
import { explicitImportExtensionsMeta } from "./imports-metadata.ts";
import { shouldScanExplicitImportExtensions } from "./imports-shared.ts";
export { collectRestrictedImportRepositoryDiagnostics } from "./imports-direct-import-diagnostics.ts";

export async function collectExplicitImportExtensionDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  if (!(await shouldScanExplicitImportExtensions(repository, context))) {
    return [];
  }

  const importExtensionDiagnostics = (await collectSourceAudit(context)).imports.filter(
    (entry) => entry.extensions,
  );

  const MAX_INDIVIDUAL_FINDINGS = 200;
  if (importExtensionDiagnostics.length > MAX_INDIVIDUAL_FINDINGS) {
    const fileCount = new Set(importExtensionDiagnostics.map((d) => d.relativePath)).size;
    return [
      buildRepositoryDiagnostic(repository, explicitImportExtensionsMeta, {
        location: { path: "repository", line: 1, column: 1 },
        severity: "suggestion",
        message: `Found ${importExtensionDiagnostics.length} extensionless imports across ${fileCount} files. Too many to list individually.`,
        why: "An explicit relative import names the runtime file directly, for example `./blocks.ts` or `./Button.tsx`. An extensionless import such as `./blocks` leaves the resolver to try candidate paths like `.ts`, `.tsx`, `.js`, `.jsx`, and `index.*`. In large Vite-family repositories, that repeated filesystem probing can add up during dev server startup, transforms, tests, and builds.",
        suggestion:
          "Add runtime file extensions to relative JavaScript and TypeScript imports, such as `./foo.ts` or `./foo.tsx`, so resolvers can skip extension and index-file probing; leave package imports unchanged.",
        measurementHint:
          "Compare Vite dev server startup, transform, test, or build wall-clock time before and after adding explicit extensions to frequently used relative imports.",
        aiHandoff:
          "Review extensionless imports flagged by the source import audit and add explicit runtime file extensions. Leave package imports unchanged.",
        score: 84,
      }),
    ];
  }

  return importExtensionDiagnostics.map(({ source, line, column, relativePath }) => {
    return buildRepositoryDiagnostic(repository, explicitImportExtensionsMeta, {
      location: {
        path: relativePath,
        line,
        column,
      },
      message: `Source import audit flagged an extensionless import path in ${relativePath}: '${source}'.`,
      why: "An explicit relative import names the runtime file directly, for example `./blocks.ts` or `./Button.tsx`. An extensionless import such as `./blocks` leaves the resolver to try candidate paths like `.ts`, `.tsx`, `.js`, `.jsx`, and `index.*`. In large Vite-family repositories, that repeated filesystem probing can add up during dev server startup, transforms, tests, and builds.",
      suggestion:
        "Add runtime file extensions to relative JavaScript and TypeScript imports, such as `./foo.ts` or `./foo.tsx`, so resolvers can skip extension and index-file probing; leave package imports unchanged.",
      measurementHint:
        "Compare Vite dev server startup, transform, test, or build wall-clock time before and after adding explicit extensions to frequently used relative imports.",
      aiHandoff:
        "Review relative JavaScript and TypeScript imports flagged by the source import audit and add explicit runtime file extensions. Leave package imports unchanged, and preserve the repository's TypeScript module resolution behavior.",
      score: 84,
    });
  });
}
