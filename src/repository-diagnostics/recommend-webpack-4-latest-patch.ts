import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  packageJsonDependencyVersionSpec,
  parseSemverLikeVersionSpec,
} from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const recommendWebpack4LatestPatchMeta = {
  id: "recommend-webpack-4-latest-patch",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/recommend-webpack-4-latest-patch.md",
} satisfies RuleMeta;

export async function collectRecommendWebpack4LatestPatchDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJson = packageJsonEntry.value;

  if (!packageJson) {
    return [];
  }

  const webpackVersionSpec = packageJsonDependencyVersionSpec(packageJson, "webpack");
  if (!webpackVersionSpec) {
    return [];
  }

  const parsed = parseSemverLikeVersionSpec(webpackVersionSpec);
  if (parsed.major !== 4) {
    return [];
  }

  const currentPatch = parsed.patch ?? 0;
  if (currentPatch >= 47) {
    return [];
  }

  const relativePath = packageJsonEntry.path.startsWith(repoRoot)
    ? packageJsonEntry.path.slice(repoRoot.length + 1)
    : packageJsonEntry.path;

  return [
    buildRepositoryDiagnostic(repository, recommendWebpack4LatestPatchMeta, {
      location: {
        path: relativePath,
        line: 1,
        column: 1,
      },
      message: `webpack ${webpackVersionSpec} is pinned to 4.x but below 4.47.`,
      why: "webpack 4.47 includes performance improvements and bug fixes accumulated across the 4.x lifecycle. Upgrading to 4.47 first reduces risk and prepares the codebase for a future webpack 5 migration.",
      suggestion: `Upgrade webpack to ^4.47.0 in ${relativePath}. Review the webpack 4 changelog for breaking changes between your current version and 4.47.`,
      measurementHint:
        "Compare CI build time before and after the upgrade. Verify that the build output and behavior remain unchanged.",
      aiHandoff: `Update webpack version in ${relativePath} to ^4.47.0. Do not change other dependencies or configuration unless required for compatibility.`,
      score: 30,
    }),
  ];
}
