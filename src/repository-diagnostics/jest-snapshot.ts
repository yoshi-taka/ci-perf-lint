import path from "node:path";
import { packageJsonHasDependency } from "../repository-package-helpers.ts";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { collectSourceAudit } from "./source-audit.ts";
import { findExternalSnapshots } from "./external-snapshots.ts";

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
    if (text[index] === "\r") {
      if (text[index + 1] === "\n") {
        index++;
      }
      lineStarts.push(index + 1);
    } else if (text[index] === "\n" || text[index] === "\u2028" || text[index] === "\u2029") {
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
    include: (candidatePath) => candidatePath.endsWith(".snap"),
  })) {
    const source = await context.readTextFileOrWarn(context.resolve(relativePath));
    if (!source) {
      continue;
    }

    const lineStarts = buildLineStartOffsets(source);
    let snapshots: Awaited<ReturnType<typeof findExternalSnapshots>>;
    try {
      snapshots = await findExternalSnapshots(source);
    } catch (error) {
      context.warn(
        "source-audit",
        `External snapshot audit failed for ${relativePath}: ${String(error)}`,
      );
      continue;
    }
    if (!snapshots) {
      context.warn(
        "source-audit",
        `External snapshot audit incomplete: could not parse ${relativePath}.`,
      );
      continue;
    }
    for (const { name: snapshotName, lineCount, offset } of snapshots) {
      const location = lineColumnForIndex(lineStarts, offset);
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
            "Split or replace the flagged snapshot with smaller, focused assertions. Review intentional exceptions explicitly; target lint configuration does not configure this audit.",
          measurementHint:
            "Compare Jest wall-clock time and failure output size before and after reducing the flagged snapshots, especially on jobs that update or diff snapshots.",
          aiHandoff:
            "Review large snapshots flagged by the source audit. Prefer targeted assertions or smaller snapshots; document intentional exceptions rather than assuming target lint allowlists affect this audit.",
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

  if (!repository.primaryWorkflowPath) {
    return [];
  }

  const snapshotDiagnostics = (await collectSourceAudit(context)).snapshots;

  const inlineSnapshotDiagnostics = snapshotDiagnostics.map(
    ({ line, column, lineCount, relativePath }) => {
      return buildRepositoryDiagnostic(repository, largeJestSnapshotMeta, {
        location: {
          path: relativePath,
          line,
          column,
        },
        message: `Source audit flagged a large Jest snapshot in ${relativePath}: inline snapshot is ${lineCount} lines long.`,
        why: "Large Jest snapshots are slow to review and easy to rubber-stamp. They also add parsing, transform, diff, and output work to test runs when failures occur.",
        suggestion:
          "Split or replace the flagged snapshot with smaller, focused assertions. For an intentional inline snapshot, use a focused jest/no-large-snapshots suppression comment with a reason.",
        measurementHint:
          "Compare Jest wall-clock time and failure output size before and after reducing the flagged snapshots, especially on jobs that update or diff snapshots.",
        aiHandoff:
          "Review inline snapshots flagged by the source audit. Prefer targeted assertions or smaller snapshots; use a focused suppression comment with a reason only for intentionally large snapshots that are regularly reviewed.",
        score: 78,
      });
    },
  );
  return [
    ...inlineSnapshotDiagnostics,
    ...(await collectExternalJestSnapshotDiagnostics(context, repository)),
  ];
}
