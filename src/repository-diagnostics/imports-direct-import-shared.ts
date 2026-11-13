import type { RuleMeta, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { SourceImport } from "./source-audit-parser.ts";
import { nextjsHasAutomaticMuiImportOptimization } from "./imports-shared.ts";

interface RestrictedImportRuleContent {
  message: (relativePath: string, contextText: string) => string;
  why: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: string;
  score: number;
}

export interface RestrictedImportRuleDefinition {
  enabled: boolean;
  meta: RuleMeta;
  exactSources?: readonly string[];
  matches?: (source: string | undefined, relativePath: string) => boolean;
  accepts?: (entry: SourceImport) => boolean;
  content: RestrictedImportRuleContent;
}

export function buildRestrictedImportDiagnostic(
  repository: RepositorySignals,
  meta: RuleMeta,
  entry: SourceImport,
  content: RestrictedImportRuleContent,
): Diagnostic {
  const contextText = entry.dynamic
    ? `Literal dynamic import from '${entry.source}'.`
    : `Runtime import or re-export from '${entry.source}'.`;
  const lazyCaution = entry.dynamic
    ? " Preserve lazy loading and promise/namespace behavior; narrow dynamic subpaths only after checking consumers and the exported API."
    : "";

  return buildRepositoryDiagnostic(repository, meta, {
    location: {
      path: entry.relativePath,
      line: entry.line,
      column: entry.column,
    },
    message: content.message(entry.relativePath, contextText),
    why: content.why,
    suggestion: content.suggestion + lazyCaution,
    measurementHint: content.measurementHint,
    aiHandoff: content.aiHandoff + lazyCaution,
    score: content.score,
  });
}

export function regexMatcher(pattern: string): (source: string | undefined) => boolean {
  const regex = new RegExp(pattern);
  return (source) => typeof source === "string" && regex.test(source);
}

export function suffixMatcher(...suffixes: string[]): (source: string | undefined) => boolean {
  return (source) =>
    typeof source === "string" && suffixes.some((suffix) => source.endsWith(suffix));
}

export function dependencyIndexHasAnyDependency(
  dependencyIndex: ReadonlySet<string>,
  dependencyNames: readonly string[],
): boolean {
  return dependencyNames.some((dependencyName) => dependencyIndex.has(dependencyName));
}

export function dependencyIndexHasEffectDependency(dependencyIndex: ReadonlySet<string>): boolean {
  if (dependencyIndex.has("effect")) {
    return true;
  }

  for (const dependencyName of dependencyIndex) {
    if (/^@effect[/][^/]+$/.test(dependencyName)) {
      return true;
    }
  }

  return false;
}

export function createMuiBarrelImportContent(
  repository: RepositorySignals,
): RestrictedImportRuleContent {
  const hasNextjsAutomaticOptimization = nextjsHasAutomaticMuiImportOptimization(repository);
  const nextjsContext = hasNextjsAutomaticOptimization
    ? " This repository appears to use Next.js 13.5 or newer, where Next.js can optimize package imports automatically, so do not add Babel plugins just for this; treat path imports and `no-restricted-imports` as cleanup and guardrails for non-Next tooling too."
    : "";

  return {
    message: (relativePath, contextText) =>
      `Source import audit flagged ${relativePath} for a top-level MUI import. ${contextText}`,
    why: `Material UI recommends avoiding top-level barrel imports such as \`@mui/material\` and \`@mui/icons-material\` because they can slow development startup and rebuilds, especially for icon imports.${nextjsContext}`,
    suggestion:
      "Run `npx @mui/codemod@latest v5.0.0/path-imports <path>` (or `bunx @mui/codemod@latest v5.0.0/path-imports <path>`) to replace existing MUI barrel imports, then prevent regressions with `no-restricted-imports`.",
    measurementHint:
      "Compare dev server startup, rebuild, lint, test, or build wall-clock time before and after replacing MUI barrel imports.",
    aiHandoff:
      "Find MUI imports flagged by `eslint(no-restricted-imports)` and rewrite them with `npx @mui/codemod@latest v5.0.0/path-imports <path>` or the package manager equivalent. If the project is on Next.js 13.5 or newer, do not add Babel plugins solely for MUI import optimization.",
    score: 66,
  };
}

export interface MakeContentOptions {
  flaggedDescription: string;
  why: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: string;
  score: number;
}

export function makeContent(options: MakeContentOptions): RestrictedImportRuleContent {
  return {
    message: (relativePath, contextText) =>
      `Source import audit flagged ${relativePath} for ${options.flaggedDescription}. ${contextText}`,
    why: options.why,
    suggestion: options.suggestion,
    measurementHint: options.measurementHint,
    aiHandoff: options.aiHandoff,
    score: options.score,
  };
}
