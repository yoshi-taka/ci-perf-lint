import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  packageJsonDependencyVersionSpec,
  parseSemverLikeVersionSpec,
} from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const recommendWebpack5LatestPatchMeta = {
  id: "recommend-webpack-5-latest-patch",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/recommend-webpack-5-latest-patch.md",
} satisfies RuleMeta;

export async function collectRecommendWebpack5LatestPatchDiagnostics(
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
  if (parsed.major !== 5) {
    return [];
  }

  const currentPatch = parsed.patch ?? 0;
  if (currentPatch >= 50) {
    return [];
  }

  const relativePath = packageJsonEntry.path.startsWith(repoRoot)
    ? packageJsonEntry.path.slice(repoRoot.length + 1)
    : packageJsonEntry.path;

  return [
    buildRepositoryDiagnostic(repository, recommendWebpack5LatestPatchMeta, {
      location: {
        path: relativePath,
        line: 1,
        column: 1,
      },
      message: `webpack ${webpackVersionSpec} is pinned to 5.x but below 5.50.`,
      why: "webpack 5.50+ includes significant performance improvements including faster incremental builds, better tree-shaking, and reduced memory usage. Upgrading within the 5.x line is typically low-risk.",
      suggestion: `Upgrade webpack to ^5.50.0 in ${relativePath}. Review the webpack 5 changelog for changes between your current version and 5.50.`,
      measurementHint:
        "Compare CI build time before and after the upgrade. Verify that the build output and behavior remain unchanged.",
      aiHandoff: `Update webpack version in ${relativePath} to ^5.50.0. Do not change other dependencies or configuration unless required for compatibility.`,
      score: 35,
    }),
  ];
}
