import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";
import {
  eslintVersionIsPromotableToConcurrency,
  eslintVersionSupportsConcurrency,
  textRunsEslintWithoutConcurrency,
} from "../rules/shared/eslint-concurrency.ts";

const meta = {
  id: "prefer-eslint-concurrency",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-eslint-concurrency.md",
} satisfies RuleMeta;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function findKeyLocation(text: string, key: string): { line: number; column: number } {
  const match = new RegExp(`"${escapeRegex(key)}"\\s*:`).exec(text);
  return lineColumnForIndex(text, match?.index ?? 0);
}

function normalizeRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

export async function collectPreferEslintConcurrencyDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const { usesEslint, eslintVersionSpec, eslintMajor, eslintMinor } = repository.eslint;
  if (!usesEslint) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJsonText = packageJsonEntry.text ?? "";
  const relativePath = normalizeRelativePath(repoRoot, packageJsonEntry.path);

  if (eslintVersionSpec && eslintVersionIsPromotableToConcurrency(eslintMajor, eslintMinor)) {
    return [
      buildRepositoryDiagnostic(repository, meta, {
        location: { path: relativePath, ...findKeyLocation(packageJsonText, "eslint") },
        severity: "warning",
        message: `Repository pins eslint ${eslintVersionSpec}, below the release that added multithread linting.`,
        why: "ESLint v9.34.0 added multithread linting and the --concurrency CLI flag. On large projects with multiple CPU cores, ESLint reports a speedup of roughly 1.30x to 3.01x once files are linted across worker threads, and the driver also spent years fixing config-loader caching regressions. Staying on an older ESLint leaves CI lint jobs single-threaded and slower.",
        suggestion:
          "Move the ESLint dependency to the latest 9.x release (at least 9.34), then enable multithread linting by passing --concurrency=auto in lint commands or package scripts.",
        measurementHint:
          "Compare ESLint wall-clock time before and after the upgrade and the --concurrency change, and re-measure on the actual CI runner because virtualized or limited CPU cores can reduce the gain.",
        aiHandoff: `Review ${relativePath} and raise the eslint dependency to the latest 9.x release (at least 9.34). Flat config is already required on ESLint 9, so no config-format migration is needed. Then update lint scripts to pass --concurrency=auto and verify the project still lints the same files.`,
        score: 48,
      }),
    ];
  }

  if (!eslintVersionSupportsConcurrency(eslintMajor, eslintMinor)) {
    return [];
  }

  const scripts = asRecord(packageJsonEntry.value?.scripts);
  if (!scripts) {
    return [];
  }

  const offendingScripts: string[] = [];
  for (const [scriptName, command] of Object.entries(scripts)) {
    if (typeof command === "string" && textRunsEslintWithoutConcurrency(command)) {
      offendingScripts.push(scriptName);
    }
  }

  if (offendingScripts.length === 0) {
    return [];
  }

  const quotedScripts = offendingScripts.map((scriptName) => `"${scriptName}"`);
  const location: SourceLocation = {
    path: relativePath,
    ...findKeyLocation(packageJsonText, offendingScripts[0]!),
  };

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location,
      severity: "suggestion",
      message:
        offendingScripts.length === 1
          ? `package.json script ${quotedScripts[0]} runs ESLint without multithread linting.`
          : `package.json scripts run ESLint without multithread linting: ${quotedScripts.join(", ")}.`,
      why: "ESLint 9.34 and later can lint files across worker threads with --concurrency. The flag is opt-in and defaults to off, so lint scripts that do not pass it stay single-threaded and take longer on multi-core CI runners.",
      suggestion:
        "Pass --concurrency=auto to the ESLint invocation in the affected package scripts, or set a fixed thread count that matches the CI runner cores.",
      measurementHint:
        "Compare package script duration before and after adding --concurrency, and test auto against a fixed thread count on the actual CI runner because initialization-heavy configs or limited cores can reduce the gain.",
      aiHandoff: `Review ${relativePath} and add --concurrency=auto to the ESLint invocation in script ${quotedScripts[0]}. Leave the rest of each script unchanged and confirm the same files are linted.`,
      score: 40,
    }),
  ];
}
