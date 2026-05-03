import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "avoid-prettier-eslint",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-prettier-eslint.md",
} satisfies RuleMeta;

const prettierConfigFileNames = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.json5",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.toml",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
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

export async function collectAvoidPrettierEslintDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const { usesPrettierEslint } = repository.prettier;
  if (!usesPrettierEslint) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  let location: SourceLocation | undefined;

  const configPatterns = [/prettier-eslint/gi];

  for (const fileName of prettierConfigFileNames) {
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

  location ??= { path: "package.json", line: 1, column: 1 };

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location,
      message:
        "Repository config or dependencies indicate prettier-eslint is still part of the formatting or linting path.",
      why: "Chaining Prettier and ESLint fix behavior through prettier-eslint is usually slower and harder to reason about than keeping formatter and linter steps separate.",
      suggestion:
        "Consider removing prettier-eslint and running Prettier and ESLint as separate commands or CI steps.",
      measurementHint:
        "Compare formatter and lint wall-clock time before and after splitting prettier-eslint into separate commands.",
      aiHandoff:
        "Review repository scripts, dependencies, and CI entrypoints together, and replace prettier-eslint-based formatting flows with separate Prettier and ESLint commands if the wrapper is still in use.",
      score: 56,
    }),
  ];
}
