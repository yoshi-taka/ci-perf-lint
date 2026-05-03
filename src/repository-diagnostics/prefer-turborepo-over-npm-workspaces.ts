import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const preferTurborepoOverNpmWorkspacesMeta = {
  id: "prefer-turborepo-over-npm-workspaces",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-turborepo-over-npm-workspaces.md",
} satisfies RuleMeta;

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

function packageManagerUsesNpm(packageJson: Record<string, unknown>): boolean {
  const packageManager = packageJson.packageManager;
  return (
    typeof packageManager === "string" && packageManager.trim().toLowerCase().startsWith("npm@")
  );
}

function scriptsUseNpm(packageJson: Record<string, unknown>): boolean {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object") {
    return false;
  }

  return Object.values(scripts).some(
    (script) => typeof script === "string" && /\bnpm(?:\s+run)?\b/.test(script),
  );
}

export async function collectPreferTurborepoOverNpmWorkspacesDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  if (
    repository.frameworks.usesTurbo ||
    repository.frameworks.usesNx ||
    repository.frameworks.usesLerna
  ) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  const packageJsonText = packageJsonEntry.text ?? "";

  if (!packageJson || !packageJsonText) {
    return [];
  }

  const workspaces = packageJson.workspaces;
  if (!workspaces) {
    return [];
  }

  const packages: string[] = Array.isArray(workspaces)
    ? workspaces.filter((w: unknown): w is string => typeof w === "string")
    : typeof workspaces === "object" && "packages" in workspaces
      ? (workspaces as { packages: unknown[] }).packages.filter(
          (w: unknown): w is string => typeof w === "string",
        )
      : [];

  if (packages.length === 0) {
    return [];
  }

  if (packages.length <= 2) {
    return [];
  }

  const packageLockExists = await context.pathExists(path.join(repoRoot, "package-lock.json"));
  const primarilyUsesNpm =
    packageManagerUsesNpm(packageJson) || packageLockExists || scriptsUseNpm(packageJson);

  if (!primarilyUsesNpm) {
    return [];
  }

  const workspaceMatch = /"workspaces"\s*:/i.exec(packageJsonText);
  const location = workspaceMatch
    ? lineColumnForIndex(packageJsonText, workspaceMatch.index)
    : { line: 1, column: 1 };

  const relativePath =
    path.relative(repoRoot, packageJsonEntry.path).replace(/\\/g, "/") ||
    path.basename(packageJsonEntry.path);
  const workspacePatterns = packages.map((p) => `"${p}"`).join(", ");

  return [
    buildRepositoryDiagnostic(repository, preferTurborepoOverNpmWorkspacesMeta, {
      location: { path: relativePath, line: location.line, column: location.column },
      message: `npm workspaces are configured in package.json with patterns: ${workspacePatterns}.`,
      why: "npm workspaces provide basic monorepo layout but lack task orchestration and caching. Turborepo can accelerate CI by caching task outputs and parallelizing builds across workspaces.",
      suggestion:
        "Consider migrating to Turborepo for workspace task orchestration and caching to reduce CI time.",
      measurementHint:
        "Compare total CI pipeline time before and after migrating to Turborepo, focusing on task execution, caching, and parallelization.",
      aiHandoff: `Review package.json workspace configuration at ${relativePath} and consider migrating to Turborepo. The repo uses npm workspaces with patterns: ${workspacePatterns}. Turborepo should be added as a devDependency, and turbo.json should be configured with appropriate pipeline definitions.`,
      score: 44,
    }),
  ];
}
