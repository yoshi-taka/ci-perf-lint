import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  collectEmbeddedOxlintDiagnosticsByCode,
  type EmbeddedOxlintDiagnostic,
} from "./embedded-oxlint.ts";
import { explicitImportExtensionsMeta } from "./imports-metadata.ts";
import { looksLikeJavaScriptRepository, repositoryUsesViteFamily } from "./imports-shared.ts";
export { collectRestrictedImportRepositoryDiagnostics } from "./imports-direct-import-diagnostics.ts";

function isBuildOutputRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return /[/](?:dist|build|out)[/]/.test(normalized);
}

async function collectRequireCallKeys(
  context: RepositoryScanContext,
  diagnostics: readonly EmbeddedOxlintDiagnostic[],
): Promise<Set<string>> {
  const relevantPaths = [...new Set(diagnostics.map((entry) => entry.relativePath))];
  const pathToLines = new Map<string, string[] | undefined>();

  await Promise.all(
    relevantPaths.map(async (relativePath) => {
      pathToLines.set(
        relativePath,
        await context.readTextFileLinesOrWarn(context.resolve(relativePath)),
      );
    }),
  );

  const requireCallKeys = new Set<string>();
  for (const entry of diagnostics) {
    const sourceLine = pathToLines.get(entry.relativePath)?.[entry.diagnostic.line - 1] ?? "";
    if (/\brequire\s*\(/.test(sourceLine)) {
      requireCallKeys.add(`${entry.relativePath}:${entry.diagnostic.line}`);
    }
  }

  return requireCallKeys;
}

export async function collectExplicitImportExtensionDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  if (
    !(await looksLikeJavaScriptRepository(context)) ||
    !repository.looksLargeOrComplex ||
    !repositoryUsesViteFamily(repository)
  ) {
    return [];
  }

  if (repository.workflowCount === 0 || !repository.primaryWorkflowPath) {
    return [];
  }

  const importExtensionDiagnostics =
    (await collectEmbeddedOxlintDiagnosticsByCode(
      repoRoot,
      "eslint-plugin-import(extensions)",
      warnings,
    )) ?? [];

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
          "Review extensionless imports flagged by the embedded Oxlint `import/extensions` scan and add explicit runtime file extensions. Leave package imports unchanged.",
        score: 84,
      }),
    ];
  }

  const requireCallKeys = await collectRequireCallKeys(context, importExtensionDiagnostics);

  const filteredDiagnostics: EmbeddedOxlintDiagnostic[] = [];
  for (const entry of importExtensionDiagnostics) {
    if (isBuildOutputRelativePath(entry.relativePath)) {
      continue;
    }

    if (requireCallKeys.has(`${entry.relativePath}:${entry.diagnostic.line}`)) {
      continue;
    }

    filteredDiagnostics.push(entry);
  }

  return filteredDiagnostics.map(({ diagnostic, relativePath }) => {
    return buildRepositoryDiagnostic(repository, explicitImportExtensionsMeta, {
      location: {
        path: relativePath,
        line: diagnostic.line,
        column: diagnostic.column,
      },
      message: `Embedded Oxlint scan flagged an extensionless import path in ${relativePath}. ${diagnostic.message}`,
      why: "An explicit relative import names the runtime file directly, for example `./blocks.ts` or `./Button.tsx`. An extensionless import such as `./blocks` leaves the resolver to try candidate paths like `.ts`, `.tsx`, `.js`, `.jsx`, and `index.*`. In large Vite-family repositories, that repeated filesystem probing can add up during dev server startup, transforms, tests, and builds.",
      suggestion:
        "Add runtime file extensions to relative JavaScript and TypeScript imports, such as `./foo.ts` or `./foo.tsx`, so resolvers can skip extension and index-file probing; leave package imports unchanged.",
      measurementHint:
        "Compare Vite dev server startup, transform, test, or build wall-clock time before and after adding explicit extensions to frequently used relative imports.",
      aiHandoff:
        "Review relative JavaScript and TypeScript imports flagged by the embedded Oxlint `import/extensions` scan and add explicit runtime file extensions. Leave package imports unchanged, and preserve the repository's TypeScript module resolution behavior.",
      score: 84,
    });
  });
}
