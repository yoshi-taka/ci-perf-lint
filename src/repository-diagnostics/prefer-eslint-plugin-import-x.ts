import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-eslint-plugin-import-x",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-eslint-plugin-import-x.md",
} satisfies RuleMeta;

const eslintConfigFileNames = [
  "eslint.base.js",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.jsonc",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.mjs",
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

export async function collectPreferEslintPluginImportXDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const { usesImportPlugin, usesImportXPlugin } = repository.eslint;
  if (!usesImportPlugin || usesImportXPlugin) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  let location: SourceLocation | undefined;

  const configPatterns = [/eslint-plugin-import/gi];

  for (const fileName of eslintConfigFileNames) {
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
        "Repository-level ESLint config appears to rely on eslint-plugin-import without visible eslint-plugin-import-x usage.",
      why: "eslint-plugin-import-x is a modern faster replacement path for many import-lint setups, so repositories still on eslint-plugin-import may be paying extra lint time and dependency overhead.",
      suggestion:
        "Consider evaluating eslint-plugin-import-x as the default import-lint plugin, then keep the migration only if the current rules and resolver behavior stay compatible.",
      measurementHint:
        "Compare eslint wall-clock time and import-rule coverage before and after swapping eslint-plugin-import for eslint-plugin-import-x.",
      aiHandoff:
        "Review repository-level ESLint config and package dependencies, test eslint-plugin-import-x against the current import rules and resolver setup, and switch only if the existing checks still behave as expected.",
      score: 53,
    }),
  ];
}
