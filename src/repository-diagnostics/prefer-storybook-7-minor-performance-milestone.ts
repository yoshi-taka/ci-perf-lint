import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-storybook-7-minor-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-storybook-7-minor-performance-milestone.md",
} satisfies RuleMeta;

function milestoneWhy(currentMinor: number): string {
  if (currentMinor <= 0) {
    return "Storybook 7.0 is below several 7.x CI-relevant build improvements. The 7.1 through 7.3 line stabilized story index, lazy loading, Vite builder, and unnecessary reprocessing paths, while 7.6 is the stronger generic target because it substantially improved Webpack builder and module processing performance.";
  }

  if (currentMinor <= 3) {
    return "Storybook 7.1 through 7.3 improved story index, lazy loading, Vite builder maturity, and unnecessary reprocessing paths, but 7.6 is the stronger 7.x CI target because it adds much larger Webpack builder, build pipeline, and module processing optimizations.";
  }

  return "Storybook 7.4 and 7.5 improved the Docs and MDX pipeline, TypeScript handling, and addon processing, but 7.6 is the higher-value 7.x CI milestone because it significantly speeds up the Webpack builder and build/module processing path.";
}

export function collectPreferStorybook7MinorPerformanceMilestoneDiagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
): Diagnostic[] {
  const { storybookVersionSpec, storybookMajor, storybookMinor } = repository.frameworks;
  if (
    !storybookVersionSpec ||
    storybookMajor !== 7 ||
    storybookMinor === undefined ||
    storybookMinor >= 6
  ) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: "package.json", line: 1, column: 1 },
      message: `The repository is on Storybook ${storybookVersionSpec}, below the 7.6 build-performance milestone.`,
      why: milestoneWhy(storybookMinor),
      suggestion: `If a major-version upgrade is not feasible yet, move Storybook from ${storybookVersionSpec} to at least 7.6.x as the highest-value 7.x CI build target.`,
      measurementHint:
        "Compare `build-storybook` wall-clock time, Docs and MDX build time, Webpack builder time, module processing time, and peak memory before and after upgrading to Storybook 7.6.x.",
      aiHandoff: `Review the repository Storybook version. If compatibility allows, upgrade Storybook from ${storybookVersionSpec} to at least 7.6.x, then compare build-storybook time, Docs and MDX build time, Webpack builder time, module processing, and peak memory.`,
      score: storybookMinor >= 4 ? 51 : 49,
    }),
  ];
}
