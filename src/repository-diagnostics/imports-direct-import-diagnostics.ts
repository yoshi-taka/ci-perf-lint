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
import type { EmbeddedOxlintDiagnostic } from "./embedded-oxlint.ts";
import path from "node:path";

function classifyDefinitions(definitions: RestrictedImportRuleDefinition[]): {
  exactSourceDefinitions: Map<string, RestrictedImportRuleDefinition[]>;
  patternDefinitions: RestrictedImportRuleDefinition[];
} {
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

  return { exactSourceDefinitions, patternDefinitions };
}

function matchRestrictedImportFindings(
  entry: EmbeddedOxlintDiagnostic & { source?: string },
  exactSourceDefinitions: Map<string, RestrictedImportRuleDefinition[]>,
  patternDefinitions: RestrictedImportRuleDefinition[],
  repository: RepositorySignals,
): Diagnostic[] {
  const findings: Diagnostic[] = [];
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

  return findings;
}

export async function collectRestrictedImportRepositoryDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  if (!(await looksLikeJavaScriptRepository(context)).value) {
    return [];
  }

  if (repository.workflowCount === 0 || !repository.primaryWorkflowPath) {
    return [];
  }

  const [dependencyIndexResult, usesMuiResult, indexedDiagnosticsResult] = await Promise.allSettled(
    [
      context.loadDependencyIndex(),
      repositoryUsesMui(context),
      collectIndexedRestrictedImportDiagnostics(repoRoot, warnings, scanContext),
    ],
  );

  if (
    dependencyIndexResult.status === "rejected" ||
    usesMuiResult.status === "rejected" ||
    indexedDiagnosticsResult.status === "rejected"
  ) {
    return [];
  }

  const dependencyIndex = new Set(dependencyIndexResult.value);
  const packageJsonFiles = await context.walkFiles(".", {
    cacheKey: "restricted-import-package-json",
    include: (file) =>
      path.basename(file) === "package.json" &&
      !/(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.next)\//.test(file),
  });
  for (const file of packageJsonFiles.sort().slice(0, 200)) {
    if (file === "package.json") {
      continue;
    }
    const entry = await context.loadPackageJson(file);
    const value = entry.value;
    if (!value || typeof value !== "object") {
      continue;
    }
    for (const sectionName of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const) {
      const section = value[sectionName];
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        continue;
      }
      for (const name of Object.keys(section)) {
        dependencyIndex.add(name);
      }
    }
  }
  const usesMui = usesMuiResult.value;
  const indexedDiagnostics = indexedDiagnosticsResult.value;
  const definitions = createRestrictedImportRuleDefinitions(
    repository,
    dependencyIndex,
    usesMui,
  ).filter((definition) => definition.enabled);
  const { exactSourceDefinitions, patternDefinitions } = classifyDefinitions(definitions);
  const findings: Diagnostic[] = [];

  for (const entry of indexedDiagnostics.diagnostics) {
    findings.push(
      ...matchRestrictedImportFindings(
        entry,
        exactSourceDefinitions,
        patternDefinitions,
        repository,
      ),
    );
  }

  return findings;
}
