import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  packageJsonDependencyVersionSpec,
  parseSemverLikeVersionSpec,
} from "../repository-package-helpers.ts";
import { lineColumnForIndex } from "../rules/shared/command-patterns.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-vitest-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-vitest-performance-milestone.md",
} satisfies RuleMeta;

interface VitestMilestone {
  target: string;
  why: string;
  suggestion: string;
  measurementHint: string;
}

function getNextVitestPerformanceMilestone(major: number): VitestMilestone | undefined {
  if (major < 3) {
    return {
      target: "3",
      why: "Vitest 3 adds browser `instances`, which run multiple browser setups against a single Vite server so shared files are transformed once instead of per workspace entry.",
      suggestion:
        "Move to Vitest 3 as the next step. Note that Vitest 3.0.0 also introduced a performance regression that was fixed in 3.0.1, so target 3.0.1 or later.",
      measurementHint:
        "Compare browser-mode wall-clock time and cache reuse before and after moving to Vitest 3, and confirm the run is on 3.0.1 or later.",
    };
  }

  if (major === 3) {
    return {
      target: "4",
      why: "Vitest 4 makes a broad set of internal performance changes: it avoids spawning workers that get no tests, stops setting `process.title`, drops chai as a direct dependency, reduces dynamic imports, delays populating node globals, uses one fetcher per project, resolves environments up front, and switches to `meta.resolve`. Browser Mode also becomes stable.",
      suggestion:
        "Move to Vitest 4 as the next step, then review the Vitest 4 migration guide for breaking changes before running the suite.",
      measurementHint:
        "Compare full `vitest run` wall-clock time and startup time before and after moving to Vitest 4.",
    };
  }

  if (major === 4) {
    return {
      target: "5",
      why: "Vitest 5 makes performance its main focus. Against Vitest 4.1, the maintainers' benchmarks show a vmThreads dependency-heavy app dropping about 53%, a vmForks happy-dom suite about 25%, and a 1,280-module monolith about 19%. Changes include sharing the Vite server across inline projects, a stable on-disk fsModuleCache, serving warm modules to workers in one round trip, reusing compiled code across vm pool contexts with module-graph prewarming, adaptive Browser Mode startup, and bundling Vitest's own dependencies. Vitest 4.1 already added the experimental `viteModuleRunner: false` opt-in for faster native-import runs.",
      suggestion:
        "Move to Vitest 5. It is a breaking major and requires Vite >= 6.4 and Node.js >= 22.12; review the Vitest 5 migration guide, then run the suite and compare wall-clock time.",
      measurementHint:
        "Compare full `vitest run` wall-clock time and peak memory before and after, especially for vm pools, Browser Mode, and large isolated suites.",
    };
  }

  return undefined;
}

export async function collectPreferVitestPerformanceMilestoneDiagnostics(
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

  const versionSpec = packageJsonDependencyVersionSpec(packageJson, "vitest");
  if (!versionSpec) {
    return [];
  }

  const { major } = parseSemverLikeVersionSpec(versionSpec);
  if (major === undefined) {
    return [];
  }

  const milestone = getNextVitestPerformanceMilestone(major);
  if (!milestone) {
    return [];
  }

  const packageJsonText = packageJsonEntry.text ?? "";
  const keyMatch = /"vitest"\s*:/.exec(packageJsonText);
  const location = lineColumnForIndex(packageJsonText, keyMatch?.index ?? 0);

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: path.relative(repoRoot, packageJsonEntry.path).replace(/\\/g, "/") || "package.json",
        line: location.line,
        column: location.column,
      },
      message: `Repository is on Vitest ${versionSpec}, below the Vitest ${milestone.target} speed milestone.`,
      why: milestone.why,
      suggestion: milestone.suggestion,
      measurementHint: milestone.measurementHint,
      aiHandoff: `Upgrade Vitest from ${versionSpec} to ${milestone.target}.x as the next speed milestone, review that major's migration guide for breaking changes, then run the suite and confirm behavior and coverage are unchanged. ${milestone.suggestion}`,
      score: 45,
    }),
  ];
}
