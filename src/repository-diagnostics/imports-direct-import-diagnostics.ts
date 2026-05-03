import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { collectIndexedRestrictedImportDiagnostics } from "./embedded-oxlint.ts";
import {
  buildRestrictedImportDiagnostic,
  type RestrictedImportRuleDefinition,
} from "./imports-direct-import-shared.ts";
import { createRestrictedImportRuleDefinitions } from "./imports-direct-import-rule-definitions.ts";
import { looksLikeJavaScriptRepository, repositoryUsesMui } from "./imports-shared.ts";

export async function collectRestrictedImportRepositoryDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  if (!(await looksLikeJavaScriptRepository(context))) {
    return [];
  }

  if (repository.workflowCount === 0 || !repository.primaryWorkflowPath) {
    return [];
  }

  const [dependencyIndexResult, usesMuiResult, indexedDiagnosticsResult] = await Promise.allSettled(
    [
      context.loadDependencyIndex(),
      repositoryUsesMui(context),
      collectIndexedRestrictedImportDiagnostics(repoRoot, warnings),
    ],
  );

  if (
    dependencyIndexResult.status === "rejected" ||
    usesMuiResult.status === "rejected" ||
    indexedDiagnosticsResult.status === "rejected"
  ) {
    return [];
  }

  const dependencyIndex = dependencyIndexResult.value;
  const usesMui = usesMuiResult.value;
  const indexedDiagnostics = indexedDiagnosticsResult.value;
  const definitions = createRestrictedImportRuleDefinitions(
    repository,
    dependencyIndex,
    usesMui,
  ).filter((definition) => definition.enabled);
  const exactSourceDefinitions = new Map<string, RestrictedImportRuleDefinition[]>();
  const patternDefinitions: RestrictedImportRuleDefinition[] = [];

  for (const definition of definitions) {
    if (definition.exactSources && definition.exactSources.length > 0) {
      for (const source of definition.exactSources) {
        const existing = exactSourceDefinitions.get(source);
        if (existing) {
          existing.push(definition);
        } else {
          exactSourceDefinitions.set(source, [definition]);
        }
      }
    }

    if (definition.matches) {
      patternDefinitions.push(definition);
    }
  }

  const findings: Diagnostic[] = [];

  for (const entry of indexedDiagnostics.diagnostics) {
    const source = entry.source;
    if (source) {
      for (const definition of exactSourceDefinitions.get(source) ?? []) {
        findings.push(
          buildRestrictedImportDiagnostic(repository, definition.meta, entry, definition.content),
        );
      }
    }

    for (const definition of patternDefinitions) {
      if (!definition.matches?.(source, entry.relativePath)) {
        continue;
      }

      findings.push(
        buildRestrictedImportDiagnostic(repository, definition.meta, entry, definition.content),
      );
    }
  }

  return findings;
}
