import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-ruff-format-over-black",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-ruff-format-over-black.md",
} satisfies RuleMeta;

const pythonToolSignalFileNames = [
  "pyproject.toml",
  "setup.cfg",
  "tox.ini",
  ".flake8",
  "requirements.txt",
  "requirements-dev.txt",
  "Pipfile",
  "Pipfile.lock",
  "poetry.lock",
  "uv.lock",
];

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

function findEvidenceLocation(
  text: string,
  patterns: RegExp[],
): { line: number; column: number } | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return lineColumnForIndex(text, match.index);
    }
  }
  return undefined;
}

function normalizeRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

export async function collectPreferRuffFormatOverBlackDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const { usesBlack, usesRuff } = repository.python;
  if (!usesBlack || usesRuff) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  let location: SourceLocation | undefined;

  const configPatterns = [/\bblack\b/gi];

  for (const fileName of pythonToolSignalFileNames) {
    const configPath = context.resolve(fileName);
    if (!(await context.pathExists(configPath))) {
      continue;
    }
    const configText = await context.readTextFileOrWarn(configPath);
    if (!configText) {
      continue;
    }

    const found = findEvidenceLocation(configText, configPatterns);
    if (found) {
      location = { path: fileName, line: found.line, column: found.column };
      break;
    }
  }

  if (!location) {
    const packageJsonEntry = await context.loadPackageJson();
    if (packageJsonEntry.text) {
      const found = findEvidenceLocation(packageJsonEntry.text, configPatterns);
      if (found) {
        location = {
          path: normalizeRelativePath(repoRoot, packageJsonEntry.path),
          line: found.line,
          column: found.column,
        };
      }
    }
  }

  location ??= { path: "pyproject.toml", line: 1, column: 1 };

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location,
      message: "Repository appears to use Black without visible Ruff formatting adoption.",
      why: "Ruff can often replace a dedicated Python formatter path with a faster unified toolchain.",
      suggestion:
        "If repository formatting policy allows it, consider replacing Black with ruff format or consolidating formatting under Ruff.",
      measurementHint:
        "Compare formatter step duration and output parity after testing ruff format on the same files.",
      aiHandoff:
        "Review repository Python formatting config, dependencies, and CI entrypoints together, and consider replacing Black with Ruff-based formatting only if style output remains acceptable.",
      score: 46,
    }),
  ];
}
