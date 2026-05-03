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

export function collectPreferJest30ForJest29Diagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
): Diagnostic[] {
  const { versionSpec, major } = repository.jest;
  const { versionSpec: typescriptVersionSpec } = repository.typescript;
  const { jsdomVersionSpec, jsdomEnvironmentVersionSpec } = repository.jest;
  if (
    !versionSpec ||
    major !== 29 ||
    !typescriptMeetsJest30Minimum(repository) ||
    !jsdomMeetsJest30Compatibility(repository)
  ) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: "package.json", line: 1, column: 1 },
      message: `The repository is on Jest ${versionSpec}; TypeScript ${typescriptVersionSpec} and JSDOM compatibility evidence are already sufficient for a Jest 30 migration review.`,
      why: "Jest 30 is a high-value major for test performance because Jest's packages are bundled into fewer files, reducing module loading overhead. The official upgrade guide also sets the TypeScript floor at 5.4 and moves the jsdom environment to JSDOM 26, both of which this repository already appears ready for.",
      suggestion:
        "Plan a Jest 29 to 30 upgrade, run Oxlint `jest/no-alias-methods` first to rewrite removed matcher aliases, then follow the Jest 30 upgrade guide for CLI, config, snapshot, and mock API changes.",
      measurementHint:
        "Compare Jest wall-clock time, startup time, worker memory, and module-load-heavy test jobs before and after upgrading to Jest 30.",
      aiHandoff: `Upgrade Jest from ${versionSpec} to 30.x if compatibility checks pass. TypeScript is ${typescriptVersionSpec}; JSDOM evidence is ${jsdomVersionSpec ?? jsdomEnvironmentVersionSpec}. Before the upgrade, run or enable Oxlint \`jest/no-alias-methods\` to replace removed matcher aliases, then use https://jestjs.io/ja/docs/upgrading-to-jest30 for the migration checklist.`,
      score: 71,
    }),
  ];
}
