import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "avoid-eslint-plugin-prettier",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-eslint-plugin-prettier.md",
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

export async function collectAvoidEslintPluginPrettierDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const { usesPrettierPlugin, usesPrettierRecommendedConfig, usesPrettierRule } = repository.eslint;
  if (!usesPrettierPlugin && !usesPrettierRecommendedConfig && !usesPrettierRule) {
    return [];
  }

  const evidence = [
    usesPrettierPlugin ? "eslint-plugin-prettier" : undefined,
    usesPrettierRecommendedConfig ? "plugin:prettier/recommended" : undefined,
    usesPrettierRule ? "prettier/prettier rule" : undefined,
  ].filter((value): value is string => Boolean(value));

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  let location: SourceLocation | undefined;

  const configPatterns: RegExp[] = [];
  if (usesPrettierRecommendedConfig) {
    configPatterns.push(/plugin:prettier\/recommended/gi);
  }
  if (usesPrettierRule) {
    configPatterns.push(/['"`]prettier\/prettier['"`]\s*:/g);
  }
  if (usesPrettierPlugin) {
    configPatterns.push(/eslint-plugin-prettier/gi);
  }

  // Find the first existing config file with a
  // single synchronous pass through the in-memory file index, then
  // read only that one file.  Avoids 14 sequential async pathExists
  // calls that compete with parallel collectors for the event loop.
  const foundConfig = await context.findRootFile(eslintConfigFileNames);
  if (foundConfig) {
    const configText = await context.readTextFileOrWarn(context.resolve(foundConfig));
    if (configText) {
      const found = findEvidenceLocation(configText, configPatterns);
      if (found) {
        location = { path: foundConfig, line: found.line, column: found.column };
      }
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
        "Repository config shows Prettier being wired into ESLint through eslint-plugin-prettier style integration.",
      why: `eslint-plugin-prettier style integration runs Prettier through ESLint, which mixes formatting work into the lint path. That usually increases lint runtime and CI noise compared with running Prettier as a separate formatter step. Visible repo evidence: ${evidence.join(", ")}.`,
      suggestion:
        "Consider removing eslint-plugin-prettier style integration, keep eslint-config-prettier if needed, and run Prettier as a separate formatter step or check.",
      measurementHint:
        "Compare eslint wall-clock time and CI noise before and after removing Prettier-from-ESLint integration, and verify that formatting is still enforced separately.",
      aiHandoff:
        "Review repository ESLint config, package scripts, and CI entrypoints together, and remove Prettier-through-ESLint wiring only if formatting can run as an independent step without losing required checks.",
      score: 58,
    }),
  ];
}
