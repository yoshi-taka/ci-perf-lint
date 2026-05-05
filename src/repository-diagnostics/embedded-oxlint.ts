import path from "node:path";
import type { AnalysisWarning } from "../types.ts";
import { LruMap } from "../repository-scan-context.ts";
import {
  cleanupEmbeddedOxlintTempConfigFiles,
  type EmbeddedOxlintScanKind,
  type OxlintDiagnostic,
  runEmbeddedOxlint,
} from "./embedded-oxlint-runner.ts";

export interface EmbeddedOxlintDiagnostic {
  diagnostic: OxlintDiagnostic;
  relativePath: string;
}

interface IndexedRestrictedImportDiagnostic extends EmbeddedOxlintDiagnostic {
  source?: string;
}

const oxlintSkippedRepos = new Set<string>();

export function skipEmbeddedOxlint(repoRoot: string): void {
  oxlintSkippedRepos.add(repoRoot);
}

export function clearEmbeddedOxlintSkip(): void {
  oxlintSkippedRepos.clear();
}

const embeddedOxlintImportScanCache = new LruMap<
  string,
  Promise<OxlintDiagnostic[] | undefined>
>(64, 300_000);
const embeddedOxlintNonImportScanCache = new LruMap<
  string,
  Promise<OxlintDiagnostic[] | undefined>
>(64, 300_000);
const embeddedOxlintDiagnosticsByCodeCache = new LruMap<
  string,
  Promise<EmbeddedOxlintDiagnostic[] | undefined>
>(128, 300_000);
const restrictedImportDiagnosticIndexCache = new LruMap<
  string,
  Promise<{
    diagnostics: IndexedRestrictedImportDiagnostic[];
    diagnosticsWithSource: IndexedRestrictedImportDiagnostic[];
    diagnosticsBySource: Map<string, IndexedRestrictedImportDiagnostic[]>;
    diagnosticsByImportSuffix: Map<string, IndexedRestrictedImportDiagnostic[]>;
  }>
>(64, 300_000);

process.on("exit", () => {
  cleanupEmbeddedOxlintTempConfigFiles().catch(() => {});
});

function normalizeOxlintFilename(repoRoot: string, filename: string | undefined): string {
  if (!filename || filename.trim().length === 0) {
    return "node_modules/.cache/unknown";
  }

  if (path.isAbsolute(filename)) {
    return path.relative(repoRoot, filename) || path.basename(filename);
  }

  return filename.replace(/^[.][/\\]+/, "");
}

export function isVendoredDiagnosticPath(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  return (
    normalizedPath === "node_modules" ||
    normalizedPath.startsWith("node_modules/") ||
    normalizedPath === "vendor" ||
    normalizedPath.startsWith("vendor/")
  );
}

function embeddedOxlintScanKindForCode(code: string): EmbeddedOxlintScanKind {
  return code === "eslint(no-restricted-imports)" || code === "eslint-plugin-import(extensions)"
    ? "import"
    : "non-import";
}

function embeddedOxlintScanCacheForKind(kind: EmbeddedOxlintScanKind) {
  return kind === "import" ? embeddedOxlintImportScanCache : embeddedOxlintNonImportScanCache;
}

async function collectEmbeddedOxlintJsonDiagnostics(
  repoRoot: string,
  kind: EmbeddedOxlintScanKind,
  warnings?: AnalysisWarning[],
): Promise<OxlintDiagnostic[] | undefined> {
  if (oxlintSkippedRepos.has(repoRoot)) {
    return undefined;
  }

  const scanCache = embeddedOxlintScanCacheForKind(kind);
  const cached = scanCache.get(repoRoot);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    return runEmbeddedOxlint(repoRoot, kind, warnings);
  })();

  scanCache.set(repoRoot, promise);
  return promise;
}

export async function collectEmbeddedOxlintImportJsonDiagnostics(
  repoRoot: string,
  warnings?: AnalysisWarning[],
): Promise<OxlintDiagnostic[] | undefined> {
  return collectEmbeddedOxlintJsonDiagnostics(repoRoot, "import", warnings);
}

export async function collectEmbeddedOxlintDiagnosticsByCode(
  repoRoot: string,
  code: string,
  warnings?: AnalysisWarning[],
): Promise<EmbeddedOxlintDiagnostic[] | undefined> {
  const cacheKey = `${repoRoot}\n${code}`;
  const cached = embeddedOxlintDiagnosticsByCodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const diagnosticsLoad = (async () => {
    const diagnostics = await collectEmbeddedOxlintJsonDiagnostics(
      repoRoot,
      embeddedOxlintScanKindForCode(code),
      warnings,
    );
    if (!diagnostics) {
      return undefined;
    }

    const matchingDiagnostics = new Map<string, EmbeddedOxlintDiagnostic>();
    for (const diagnostic of diagnostics) {
      if (diagnostic.code !== code) {
        continue;
      }

      const relativePath = normalizeOxlintFilename(repoRoot, diagnostic.filename);
      if (isVendoredDiagnosticPath(relativePath)) {
        continue;
      }

      const key = `${relativePath}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`;
      matchingDiagnostics.set(key, { diagnostic, relativePath });
    }

    return [...matchingDiagnostics.values()];
  })();
  embeddedOxlintDiagnosticsByCodeCache.set(cacheKey, diagnosticsLoad);
  return diagnosticsLoad;
}

function restrictedImportSource(diagnostic: OxlintDiagnostic): string | undefined {
  const message = diagnostic.message;
  return (
    /^'([^']+)' import is restricted/.exec(message)?.[1] ??
    /^'[^']+' import from '([^']+)' is restricted/.exec(message)?.[1]
  );
}

const globLikeImportPatternSuffixes: ReadonlyMap<string, string> = new Map([
  ["**/*.svg", ".svg"],
  ["**/*.svg?react", ".svg?react"],
  ["**/*.svg?vue", ".svg?vue"],
  ["**/*.svg?component", ".svg?component"],
] as const);

async function collectRestrictedImportDiagnosticIndex(
  repoRoot: string,
  warnings?: AnalysisWarning[],
): Promise<{
  diagnostics: IndexedRestrictedImportDiagnostic[];
  diagnosticsWithSource: IndexedRestrictedImportDiagnostic[];
  diagnosticsBySource: Map<string, IndexedRestrictedImportDiagnostic[]>;
  diagnosticsByImportSuffix: Map<string, IndexedRestrictedImportDiagnostic[]>;
}> {
  const cached = restrictedImportDiagnosticIndexCache.get(repoRoot);
  if (cached) {
    return cached;
  }

  const indexLoad = (async () => {
    const diagnostics =
      (await collectEmbeddedOxlintDiagnosticsByCode(
        repoRoot,
        "eslint(no-restricted-imports)",
        warnings,
      )) ?? [];
    const indexedDiagnostics = diagnostics.map((entry) => ({
      ...entry,
      source: restrictedImportSource(entry.diagnostic),
    }));
    const diagnosticsWithSource: IndexedRestrictedImportDiagnostic[] = [];
    const diagnosticsBySource = new Map<string, IndexedRestrictedImportDiagnostic[]>();
    const diagnosticsByImportSuffix = new Map<string, IndexedRestrictedImportDiagnostic[]>();

    for (const diagnostic of indexedDiagnostics) {
      if (!diagnostic.source) {
        continue;
      }

      diagnosticsWithSource.push(diagnostic);

      const sourceDiagnostics = diagnosticsBySource.get(diagnostic.source);
      if (sourceDiagnostics) {
        sourceDiagnostics.push(diagnostic);
      } else {
        diagnosticsBySource.set(diagnostic.source, [diagnostic]);
      }

      for (const suffix of globLikeImportPatternSuffixes.values()) {
        if (!diagnostic.source.endsWith(suffix)) {
          continue;
        }

        const suffixDiagnostics = diagnosticsByImportSuffix.get(suffix);
        if (suffixDiagnostics) {
          suffixDiagnostics.push(diagnostic);
        } else {
          diagnosticsByImportSuffix.set(suffix, [diagnostic]);
        }
      }
    }

    return {
      diagnostics: indexedDiagnostics,
      diagnosticsWithSource,
      diagnosticsBySource,
      diagnosticsByImportSuffix,
    };
  })();
  restrictedImportDiagnosticIndexCache.set(repoRoot, indexLoad);

  return indexLoad;
}

export async function collectIndexedRestrictedImportDiagnostics(
  repoRoot: string,
  warnings?: AnalysisWarning[],
): Promise<{
  diagnostics: IndexedRestrictedImportDiagnostic[];
  diagnosticsWithSource: IndexedRestrictedImportDiagnostic[];
  diagnosticsBySource: Map<string, IndexedRestrictedImportDiagnostic[]>;
  diagnosticsByImportSuffix: Map<string, IndexedRestrictedImportDiagnostic[]>;
}> {
  return collectRestrictedImportDiagnosticIndex(repoRoot, warnings);
}
