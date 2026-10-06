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
  id: "consider-msw-3-upgrade",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/consider-msw-3-upgrade.md",
} satisfies RuleMeta;

export async function collectConsiderMsw3UpgradeDiagnostics(
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

  const versionSpec = packageJsonDependencyVersionSpec(packageJson, "msw");
  if (!versionSpec) {
    return [];
  }

  const { major } = parseSemverLikeVersionSpec(versionSpec);
  if (major !== 2) {
    return [];
  }

  const packageJsonText = packageJsonEntry.text ?? "";
  const keyMatch = /"msw"\s*:/.exec(packageJsonText);
  const location = lineColumnForIndex(packageJsonText, keyMatch?.index ?? 0);

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: path.relative(repoRoot, packageJsonEntry.path).replace(/\\/g, "/") || "package.json",
        line: location.line,
        column: location.column,
      },
      message: `Repository is on MSW ${versionSpec}; MSW 3.0 is available with a smaller package and faster handler lookup.`,
      why: "MSW 3.0 trims the package (tarball about 43% smaller and type definitions about 50% smaller), drops several runtime dependencies, groups handlers by kind for roughly constant-time lookup, and ships granular entrypoints (msw/http, msw/ws, msw/graphql, msw/utils) for lighter bundles and faster type-checking. It is also a breaking major: it is ESM-only, requires Node.js 22+ and TypeScript 5.9+, moves GraphQL mocking to link-first (graphql.link(url)), renames onUnhandledRequest to onUnhandledFrame, and makes worker.stop() return a Promise.",
      suggestion:
        "If upgrading is feasible, plan an MSW 2.x to 3.0 upgrade. Update imports to the new entrypoints, rewrite GraphQL handlers to link-first, rename onUnhandledRequest to onUnhandledFrame, and await worker.stop(). Official codemods are available; ESM-only is the main blocker for CommonJS Jest setups.",
      measurementHint:
        "Compare test wall-clock time for handler-heavy suites, install size, and TypeScript type-check time before and after upgrading.",
      aiHandoff: `Review package.json and upgrade MSW from ${versionSpec} to 3.x. Use the official codemods, then update imports to msw/http, msw/ws, msw/graphql, and msw/utils; migrate GraphQL handlers to graphql.link(url); rename onUnhandledRequest to onUnhandledFrame; and await worker.stop(). Confirm the project runs on Node.js 22+ and TypeScript 5.9+, and resolve the ESM-only requirement for any CommonJS test runner before merging.`,
      score: 35,
    }),
  ];
}
