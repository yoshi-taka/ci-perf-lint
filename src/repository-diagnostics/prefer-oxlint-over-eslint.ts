import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-oxlint-over-eslint",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-oxlint-over-eslint.md",
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

export async function collectPreferOxlintOverEslintDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const { usesEslint, usesOxlint, unsupportedPluginNames, usesCustomExtensions, pluginNames } =
    repository.eslint;
  if (!usesEslint || usesOxlint) {
    return [];
  }

  const compatiblePluginNames = pluginNames.filter(
    (pluginName) => !unsupportedPluginNames.includes(pluginName),
  );
  const severity: "warning" | "suggestion" =
    unsupportedPluginNames.length > 0 || usesCustomExtensions ? "suggestion" : "warning";
  const compatibilityNote =
    severity === "warning"
      ? compatiblePluginNames.length > 0
        ? `Visible ESLint plugins look compatible with Oxlint built-ins: ${compatiblePluginNames.join(", ")}.`
        : "No visible unsupported ESLint plugin dependencies were detected at the repository root."
      : unsupportedPluginNames.length > 0
        ? `Repository-level ESLint plugins may need extra migration review: ${unsupportedPluginNames.join(", ")}.`
        : "Repository-level ESLint config appears to use custom extensions or local rule wiring.";

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  let location: SourceLocation | undefined;

  const configPatterns = [/\beslint\b/gi];

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
      severity,
      message: "Repository appears to use ESLint without visible Oxlint adoption.",
      why: `Oxlint is often a drop-in or front-of-line speedup for JavaScript and TypeScript lint paths in CI. The official ESLint migration guide also documents incremental adoption, config migration, JS plugin fallback, and staged Oxlint-plus-ESLint rollouts. ${compatibilityNote}`,
      suggestion:
        severity === "warning"
          ? "Read OXC's 'Migrate from ESLint' guide first, then consider migrating the current ESLint entrypoint with @oxlint/migrate or running Oxlint before ESLint for a staged rollout."
          : "Read OXC's 'Migrate from ESLint' guide first, then evaluate Oxlint for the current lint path while verifying plugin, JS plugin, and custom-rule compatibility before replacing or fronting ESLint.",
      measurementHint:
        "Compare lint wall-clock time and rule coverage on the same target files before changing CI defaults.",
      aiHandoff:
        severity === "warning"
          ? "Start with OXC's 'Migrate from ESLint' guide, review repository lint scripts, package dependencies, and CI entrypoints together, and test whether @oxlint/migrate or an oxlint-then-eslint staged rollout can replace or front the current ESLint path without losing required coverage."
          : "Start with OXC's 'Migrate from ESLint' guide, review repository lint scripts, package dependencies, JS plugin needs, and custom ESLint behavior together, and only introduce Oxlint after confirming compatibility for the current rule set.",
      score: severity === "warning" ? 49 : 34,
    }),
  ];
}
