import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  oxlintTypeCheckMeasurementHint,
  oxlintTypeCheckSuggestion,
  oxlintTypeCheckWhy,
  textRunsTscTypeCheck,
} from "../rules/shared/oxlint-type-check.ts";

const meta = {
  id: "prefer-oxlint-type-check-over-tsc",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-oxlint-type-check-over-tsc.md",
} satisfies RuleMeta;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function scriptLocation(
  packageJsonText: string,
  scriptName: string,
): { line: number; column: number } {
  const keyMatch = new RegExp(`"${escapeRegex(scriptName)}"\\s*:`).exec(packageJsonText);
  return lineColumnForIndex(packageJsonText, keyMatch?.index ?? 0);
}

export async function collectPackageJsonOxlintTypeCheckDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  if (!repository.eslint.usesOxlint) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  const packageJsonText = packageJsonEntry.text ?? "";
  const scripts = asRecord(packageJson?.scripts);
  if (!scripts || packageJsonText.length === 0) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const relativePath = path.relative(repoRoot, packageJsonEntry.path).replace(/\\/g, "/");
  const suggestion = oxlintTypeCheckSuggestion(repository);

  for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
    if (typeof scriptCommand !== "string" || !textRunsTscTypeCheck(scriptCommand)) {
      continue;
    }

    const location = scriptLocation(packageJsonText, scriptName);
    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: relativePath || "package.json",
          line: location.line,
          column: location.column,
        },
        message: `package.json script "${scriptName}" runs a separate tsc type-check ("${scriptCommand}") while the repository uses oxlint.`,
        why: oxlintTypeCheckWhy,
        suggestion,
        measurementHint: oxlintTypeCheckMeasurementHint,
        aiHandoff: `Review package.json script "${scriptName}". Confirm oxlint and oxlint-tsgolint are current, then replace the standalone tsc type-check with \`oxlint --type-aware --type-check\` and remove the redundant tsc invocation. Keep any separate declaration/build emit.`,
        score: 45,
      }),
    );
  }

  return diagnostics;
}
