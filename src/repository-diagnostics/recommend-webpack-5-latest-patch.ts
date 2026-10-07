import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  effectiveDependencyVersionSpec,
  versionSpecIsBelow,
} from "../repository-dependency-versions.ts";
import { parseSemverLikeVersionSpec } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const WEBPACK_5_TARGET_MINOR = 53;

const recommendWebpack5LatestPatchMeta = {
  id: "recommend-webpack-5-latest-patch",
  severity: "warning",
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

  const webpackVersionSpec = await effectiveDependencyVersionSpec(context, "webpack");
  if (!webpackVersionSpec) {
    return [];
  }

  const parsed = parseSemverLikeVersionSpec(webpackVersionSpec);
  if (parsed.major !== 5) {
    return [];
  }

  const currentMinor = parsed.minor ?? 0;
  if (
    currentMinor >= WEBPACK_5_TARGET_MINOR ||
    versionSpecIsBelow(webpackVersionSpec, [5, WEBPACK_5_TARGET_MINOR, 0]) !== true
  ) {
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
      message: `webpack ${webpackVersionSpec} is declared below 5.${WEBPACK_5_TARGET_MINOR}.`,
      why: "webpack 5.x picked up default-on build-performance fixes in this range: 5.50 disabled the filesystem-cache compression that 5.42 had enabled by default, because the compression made cache builds slower, and 5.53 fixed persistent-cache builds that could take a minute or more before emitting. Later 5.x releases keep adding performance work, so the goal is to be on the latest 5.x rather than a specific milestone.",
      suggestion: `Upgrade webpack to the latest 5.x release in ${relativePath} (for example with \`npm install -D webpack@^5\`) and refresh the lockfile.`,
      measurementHint:
        "Compare CI install and build time before and after the upgrade, and measure once with the filesystem cache warm, since the 5.50 and 5.53 fixes target cached builds.",
      aiHandoff: `Review ${relativePath} and raise the webpack dependency from ${webpackVersionSpec} to the latest 5.x release (for example with \`npm install -D webpack@^5\`), then refresh the lockfile. This picks up the 5.50 cache-compression and 5.53 persistent-cache build fixes. Keep unrelated dependency and configuration changes out of the bump.`,
      score: 35,
    }),
  ];
}
