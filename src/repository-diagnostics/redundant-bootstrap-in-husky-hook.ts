import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "redundant-bootstrap-in-husky-hook",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/redundant-bootstrap-in-husky-hook.md",
} satisfies RuleMeta;

function isAtLeastHusky912(
  major: number | undefined,
  minor: number | undefined,
  patch: number | undefined,
): boolean {
  if (major === undefined || minor === undefined) {
    return false;
  }
  if (major > 9) {
    return true;
  }
  if (major < 9) {
    return false;
  }
  if (minor > 1) {
    return true;
  }
  if (minor < 1) {
    return false;
  }
  return (patch ?? 0) >= 2;
}

function hookFileLooksRelevant(content: string, shouldFlagXRunner: boolean): boolean {
  const hasBootstrap = /husky\.sh|_\/husky\.sh/i.test(content);
  const hasXRunner = /\b(npx|pnpx|pnpm\s+dlx|bunx|yarn\s+dlx|uvx|uv\s+tool\s+run)\b/i.test(content);
  return hasBootstrap || (shouldFlagXRunner && hasXRunner);
}

export function collectRedundantBootstrapInHuskyHookDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
): Diagnostic[] {
  const { major, minor, patch, hookFiles } = repository.husky;
  const versionKnown = major !== undefined && minor !== undefined;
  const shouldFlagXRunner = !versionKnown || isAtLeastHusky912(major, minor, patch);

  const relevantHooks = hookFiles.filter((hookFile) =>
    hookFileLooksRelevant(hookFile.content, shouldFlagXRunner),
  );
  if (relevantHooks.length === 0) {
    return [];
  }

  const hookPaths = relevantHooks.map((hookFile) => hookFile.path).sort();
  const usesDeprecatedBootstrap = relevantHooks.some((hookFile) =>
    /husky\.sh|_\/husky\.sh/i.test(hookFile.content),
  );
  const usesXRunner =
    shouldFlagXRunner &&
    relevantHooks.some((hookFile) =>
      /\b(npx|pnpx|pnpm\s+dlx|bunx|yarn\s+dlx|uvx|uv\s+tool\s+run)\b/i.test(hookFile.content),
    );

  if (!usesDeprecatedBootstrap && !usesXRunner) {
    return [];
  }

  const normalizedHookPath =
    path.relative(repoRoot, hookPaths[0]!).replace(/\\/g, "/") || hookPaths[0]!;

  const xrunnerNote =
    versionKnown && !shouldFlagXRunner ? " (x-runner is expected for Husky < 9.1.2)" : "";

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: normalizedHookPath, line: 1, column: 1 },
      message: `The repository has Husky hook files (${hookPaths.join(", ")}) that use ${
        usesDeprecatedBootstrap && usesXRunner
          ? "deprecated bootstrap and x-runner wrapping"
          : usesDeprecatedBootstrap
            ? "deprecated Husky bootstrap"
            : "x-runner wrapping"
      }${xrunnerNote}.`,
      why: "Deprecated Husky bootstrap and x-runner based command paths add avoidable hook startup work compared with direct commands in current Husky hook scripts.",
      suggestion:
        "Remove deprecated husky.sh bootstrap, and replace npx-style hook commands with direct local commands or package-manager-native execution where possible (Husky >= 9.1.2).",
      measurementHint:
        "Compare local hook startup time before and after removing deprecated bootstrap and x-runner wrapping.",
      aiHandoff: `Review the repository Husky hook files ${hookPaths.map((hookPath) => `\`${hookPath}\``).join(", ")}. Remove deprecated husky bootstrap if present, and replace x-runner based commands with simpler direct execution where safe (Husky >= 9.1.2).`,
      score: usesDeprecatedBootstrap && usesXRunner ? 57 : 51,
    }),
  ];
}
