import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

interface StorybookMilestoneConfig {
  id: string;
  docsPath: string;
  major: number;
  targetMinor: number;
  why: (minor: number) => string;
  measurementHint: string;
  aiHandoff: (versionSpec: string) => string;
  score: (minor: number) => number;
}

function createStorybookMilestoneCollector(config: StorybookMilestoneConfig) {
  const meta = {
    id: config.id,
    severity: "warning",
    confidence: "medium",
    docsPath: config.docsPath,
  } satisfies RuleMeta;

  return function collect(
    _repoRoot: string,
    repository: RepositorySignals,
    _warnings?: AnalysisWarning[],
  ): Diagnostic[] {
    const { storybookVersionSpec, storybookMajor, storybookMinor } = repository.frameworks;
    if (
      !storybookVersionSpec ||
      storybookMajor !== config.major ||
      storybookMinor === undefined ||
      storybookMinor >= config.targetMinor
    ) {
      return [];
    }

    return [
      buildRepositoryDiagnostic(repository, meta, {
        location: { path: "package.json", line: 1, column: 1 },
        message: `The repository is on Storybook ${storybookVersionSpec}, below the ${config.major}.${config.targetMinor} build-performance milestone.`,
        why: config.why(storybookMinor),
        suggestion: `If a major-version upgrade is not feasible yet, move Storybook from ${storybookVersionSpec} to at least ${config.major}.${config.targetMinor}.x as the highest-value ${config.major}.x CI build target.`,
        measurementHint: config.measurementHint,
        aiHandoff: config.aiHandoff(storybookVersionSpec),
        score: config.score(storybookMinor),
      }),
    ];
  };
}

const configs: StorybookMilestoneConfig[] = [
  {
    id: "prefer-storybook-6-minor-performance-milestone",
    docsPath: "docs/rules/prefer-storybook-6-minor-performance-milestone.md",
    major: 6,
    targetMinor: 5,
    measurementHint:
      "Compare `build-storybook` wall-clock time, output size, Webpack cache hit behavior, and peak memory before and after upgrading to Storybook 6.5.x.",
    aiHandoff: (ver: string) =>
      `Review the repository Storybook version. If compatibility allows, upgrade Storybook from ${ver} to at least 6.5.x, then compare build-storybook time, output size, Webpack cache behavior, and peak memory.`,
    score: (minor: number) => (minor === 4 ? 51 : 49),
    why(currentMinor: number) {
      if (currentMinor <= 1) {
        return "Storybook 6.1 improved startup and story-loading paths, but the strongest 6.x CI target is 6.5 because it added Webpack 5 support, filesystem cache support, lazy compilation support, and an experimental Vite builder path.";
      }
      if (currentMinor === 2) {
        return "Storybook 6.2 introduced Story Store v6 and more efficient story management, but 6.5 is the higher-value 6.x CI milestone because Webpack 5 and filesystem cache support can reduce repeated build work.";
      }
      if (currentMinor === 3) {
        return "Storybook 6.3 optimized CSF and reduced Docs and Controls rerendering, but 6.5 adds the more direct CI build levers: Webpack 5 support, filesystem cache support, and an experimental Vite builder.";
      }
      return "Storybook 6.4 moved public Storybook output further toward code splitting and Docs/Canvas separation, but 6.5 is the stronger 6.x CI target because it adds Webpack 5 support and filesystem cache support that can materially affect build-storybook time.";
    },
  },
  {
    id: "prefer-storybook-7-minor-performance-milestone",
    docsPath: "docs/rules/prefer-storybook-7-minor-performance-milestone.md",
    major: 7,
    targetMinor: 6,
    measurementHint:
      "Compare `build-storybook` wall-clock time, Docs and MDX build time, Webpack builder time, module processing time, and peak memory before and after upgrading to Storybook 7.6.x.",
    aiHandoff: (ver: string) =>
      `Review the repository Storybook version. If compatibility allows, upgrade Storybook from ${ver} to at least 7.6.x, then compare build-storybook time, Docs and MDX build time, Webpack builder time, module processing, and peak memory.`,
    score: (minor: number) => (minor >= 4 ? 51 : 49),
    why(currentMinor: number) {
      if (currentMinor <= 0) {
        return "Storybook 7.0 is below several 7.x CI-relevant build improvements. The 7.1 through 7.3 line stabilized story index, lazy loading, Vite builder, and unnecessary reprocessing paths, while 7.6 is the stronger generic target because it substantially improved Webpack builder and module processing performance.";
      }
      if (currentMinor <= 3) {
        return "Storybook 7.1 through 7.3 improved story index, lazy loading, Vite builder maturity, and unnecessary reprocessing paths, but 7.6 is the stronger 7.x CI target because it adds much larger Webpack builder, build pipeline, and module processing optimizations.";
      }
      return "Storybook 7.4 and 7.5 improved the Docs and MDX pipeline, TypeScript handling, and addon processing, but 7.6 is the higher-value 7.x CI milestone because it significantly speeds up the Webpack builder and build/module processing path.";
    },
  },
];

export const collectPreferStorybook6MinorPerformanceMilestoneDiagnostics =
  createStorybookMilestoneCollector(configs[0]!);
export const collectPreferStorybook7MinorPerformanceMilestoneDiagnostics =
  createStorybookMilestoneCollector(configs[1]!);
