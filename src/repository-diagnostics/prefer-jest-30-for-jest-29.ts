import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-jest-30-for-jest-29",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-jest-30-for-jest-29.md",
} satisfies RuleMeta;

function typescriptMeetsJest30Minimum(repository: RepositorySignals): boolean {
  const { major, minor } = repository.typescript;
  return major !== undefined && (major > 5 || (major === 5 && minor !== undefined && minor >= 4));
}

function jsdomMeetsJest30Compatibility(repository: RepositorySignals): boolean {
  const { jsdomMajor, jsdomEnvironmentMajor } = repository.jest;
  return (
    (jsdomMajor !== undefined && jsdomMajor >= 26) ||
    (jsdomEnvironmentMajor !== undefined && jsdomEnvironmentMajor >= 30)
  );
}

function jest29Finding(repository: RepositorySignals): Diagnostic | undefined {
  const { versionSpec, major } = repository.jest;
  const { versionSpec: typescriptVersionSpec } = repository.typescript;
  const { jsdomVersionSpec, jsdomEnvironmentVersionSpec } = repository.jest;
  if (
    !versionSpec ||
    major !== 29 ||
    !typescriptMeetsJest30Minimum(repository) ||
    !jsdomMeetsJest30Compatibility(repository)
  ) {
    return undefined;
  }

  return buildRepositoryDiagnostic(repository, meta, {
    location: { path: "package.json", line: 1, column: 1 },
    message: `The repository is on Jest ${versionSpec}; TypeScript ${typescriptVersionSpec} and JSDOM compatibility evidence are already sufficient for a Jest 30.5 migration review.`,
    why: "Jest 30 is a high-value major for test performance because Jest's packages are bundled into fewer files, reducing module loading overhead, and Jest 30.5 is the notable 30.x performance release: warm module resolution cost drops to roughly a third, per-require overhead in jest-runtime is cut, jest-snapshot lazy-loads babel, semver and synckit so every test process loads about 200 fewer modules, and jest-haste-map stops spawning watchman on warm runs. The official upgrade guide also sets the TypeScript floor at 5.4 and moves the jsdom environment to JSDOM 26, both of which this repository already appears ready for.",
    suggestion:
      "Plan a Jest 29 upgrade straight to at least 30.5.1. Run Oxlint `jest/no-alias-methods` first to rewrite removed matcher aliases, follow the Jest 30 upgrade guide for CLI, config, snapshot, and mock API changes, and avoid stopping at 30.5.0 (it had an ESM `#imports` subpath regression fixed in 30.5.1).",
    measurementHint:
      "Compare Jest wall-clock time, startup time, worker memory, and module-load-heavy test jobs before and after upgrading to Jest 30.5.1 or later.",
    aiHandoff: `Upgrade Jest from ${versionSpec} to at least 30.5.1 (not just 30.0) if compatibility checks pass. TypeScript is ${typescriptVersionSpec}; JSDOM evidence is ${jsdomVersionSpec ?? jsdomEnvironmentVersionSpec}. Before the upgrade, run or enable Oxlint \`jest/no-alias-methods\` to replace removed matcher aliases, then use https://jestjs.io/ja/docs/upgrading-to-jest30 for the migration checklist, and confirm the run is on 30.5.1 or later.`,
    score: 71,
  });
}

function jest30xFinding(repository: RepositorySignals): Diagnostic | undefined {
  const { versionSpec, major, minor } = repository.jest;
  if (!versionSpec || major !== 30 || minor === undefined || minor >= 5) {
    return undefined;
  }

  return buildRepositoryDiagnostic(repository, meta, {
    location: { path: "package.json", line: 1, column: 1 },
    message: `The repository is on Jest ${versionSpec}; Jest 30.5 cuts warm test startup cost.`,
    why: "Jest 30.5 reduced warm module resolution cost to roughly a third, cut per-require overhead in jest-runtime, lazy-loads babel, semver and synckit in jest-snapshot so every test process loads about 200 fewer modules, and stopped spawning watchman processes on warm runs by caching the socket path. Target 30.5.1 or later: 30.5.0 had an ESM `#imports` subpath regression that 30.5.1 fixed.",
    suggestion: `Move Jest from ${versionSpec} to at least 30.5.1. If the suite uses native ESM, verify package \`imports\` subpaths after upgrading.`,
    measurementHint:
      "Compare warm test wall-clock time and startup time before and after upgrading, and confirm the run is on 30.5.1 or later.",
    aiHandoff: `Upgrade Jest from ${versionSpec} to at least 30.5.1. It is the notable 30.x performance release (warm resolution cost cut to about a third, ~200 fewer modules loaded per test process). Avoid 30.5.0 for native ESM because of the \`#imports\` subpath regression, then re-run the suite and compare startup and warm-run time.`,
    score: 60,
  });
}

export function collectPreferJest30ForJest29Diagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
): Diagnostic[] {
  const finding = jest29Finding(repository) ?? jest30xFinding(repository);
  return finding ? [finding] : [];
}
