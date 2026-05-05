import path from "node:path";
import { packageJsonHasDependency } from "../repository-package-helpers.ts";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  collectEmbeddedOxlintDiagnosticsByCode,
  isVendoredDiagnosticPath,
} from "./embedded-oxlint.ts";

const largeJestSnapshotMeta = {
  id: "large-jest-snapshot",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/large-jest-snapshot.md",
} satisfies RuleMeta;

function isJestOwnRepo(repoRoot: string): boolean {
  const name = path.basename(repoRoot);
  return name === "jest" || name.startsWith("jest-") || name.endsWith("-jest");
}

async function looksLikeJavaScriptRepository(context: RepositoryScanContext): Promise<boolean> {
  const rootEntries = new Set(
    (await context.readDirectoryEntries(context.repoRoot)).map((entry) => entry.name),
  );
  return ["package.json", "tsconfig.json", "jsconfig.json"].some((fileName) =>
    rootEntries.has(fileName),
  );
}

function buildLineStartOffsets(text: string): number[] {
  const lineStarts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  return lineStarts;
}

function lineColumnForIndex(lineStarts: number[], index: number): { line: number; column: number } {
  const safeIndex = Math.max(0, index);
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;
    const nextLineStart = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;

    if (safeIndex < lineStart) {
      high = middle - 1;
      continue;
    }

    if (safeIndex >= nextLineStart) {
      low = middle + 1;
      continue;
    }

    return {
      line: middle + 1,
      column: safeIndex - lineStart + 1,
    };
  }

  return {
    line: 1,
    column: 1,
  };
}

async function collectExternalJestSnapshotDiagnostics(
  context: RepositoryScanContext,
  repository: RepositorySignals,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for await (const relativePath of context.walkFilesIter(".", {
    ignoredDirectories: new Set(["node_modules", "vendor"]),
    include: (candidatePath) =>
      candidatePath.endsWith(".snap") && !isVendoredDiagnosticPath(candidatePath),
  })) {
    const source = await context.readTextFileOrWarn(context.resolve(relativePath));
    if (!source) {
      continue;
    }

    const lineStarts = buildLineStartOffsets(source);
    const snapshotMatcher = /exports\[`([^`]+)`\]\s*=\s*`([\s\S]*?)`;/g;
    for (const match of source.matchAll(snapshotMatcher)) {
      const snapshotName = match[1] ?? "snapshot";
      const snapshotBody = match[2] ?? "";
      const lineCount = snapshotBody.split(/\r\n|\r|\n/).length;
      if (lineCount <= 300) {
        continue;
      }

      const location = lineColumnForIndex(lineStarts, match.index);
      diagnostics.push(
        buildRepositoryDiagnostic(repository, largeJestSnapshotMeta, {
          location: {
            path: relativePath,
            line: location.line,
            column: location.column,
          },
          message: `Embedded snapshot scan flagged a large Jest snapshot in ${relativePath}: ${snapshotName} is ${lineCount} lines long.`,
          why: "Large Jest snapshots are slow to review and easy to rubber-stamp. They also add parsing, transform, diff, and output work to test runs when failures occur.",
          suggestion:
            "Split or replace the flagged snapshot with smaller, focused assertions, or move broad fixture verification behind explicit allowlisted snapshot names if the large snapshot is intentional.",
          measurementHint:
            "Compare Jest wall-clock time and failure output size before and after reducing the flagged snapshots, especially on jobs that update or diff snapshots.",
          aiHandoff:
            "Review snapshots flagged by `jest/no-large-snapshots`. Prefer targeted assertions or smaller snapshots; only add `allowedSnapshots` entries for intentionally large snapshots that are regularly reviewed.",
          score: 78,
        }),
      );
    }
  }

  return diagnostics;
}

export async function collectLargeJestSnapshotDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  if (isJestOwnRepo(repoRoot)) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  if (!(await looksLikeJavaScriptRepository(context))) {
    return [];
  }

  const packageJsonEntry = await context.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  const usesJest =
    Boolean(packageJson && packageJsonHasDependency(packageJson, "jest")) ||
    Boolean(packageJson && packageJsonHasDependency(packageJson, "@jest/globals"));
  if (!usesJest) {
    return [];
  }

  if (repository.workflowCount === 0 || !repository.primaryWorkflowPath) {
    return [];
  }

  const snapshotDiagnostics = await collectEmbeddedOxlintDiagnosticsByCode(
    repoRoot,
    "eslint-plugin-jest(no-large-snapshots)",
    warnings,
  );
  if (!snapshotDiagnostics) {
    return collectExternalJestSnapshotDiagnostics(context, repository);
  }

  const inlineSnapshotDiagnostics = snapshotDiagnostics.map(({ diagnostic, relativePath }) => {
    const contextText = diagnostic.message;

    return buildRepositoryDiagnostic(repository, largeJestSnapshotMeta, {
      location: {
        path: relativePath,
        line: diagnostic.line,
        column: diagnostic.column,
      },
      message: `Embedded Oxlint scan flagged a large Jest snapshot in ${relativePath}. ${contextText}`,
      why: "Large Jest snapshots are slow to review and easy to rubber-stamp. They also add parsing, transform, diff, and output work to test runs when failures occur.",
      suggestion:
        "Split or replace the flagged snapshot with smaller, focused assertions, or move broad fixture verification behind explicit allowlisted snapshot names if the large snapshot is intentional.",
      measurementHint:
        "Compare Jest wall-clock time and failure output size before and after reducing the flagged snapshots, especially on jobs that update or diff snapshots.",
      aiHandoff:
        "Review snapshots flagged by `jest/no-large-snapshots`. Prefer targeted assertions or smaller snapshots; only add `allowedSnapshots` entries for intentionally large snapshots that are regularly reviewed.",
      score: 78,
    });
  });
  return [
    ...inlineSnapshotDiagnostics,
    ...(await collectExternalJestSnapshotDiagnostics(context, repository)),
  ];
}
