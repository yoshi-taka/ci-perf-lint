import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { rootOnlyArtifactDirs, subdirArtifactDirs } from "./waste-patterns.ts";

const meta = {
  id: "detected-large-files",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/detected-large-files.md",
} satisfies RuleMeta;

const largeFileSuffixes = [
  ".csv",
  ".tsv",
  ".jsonl",
  ".ndjson",
  ".parquet",
  ".pdf",
  ".zip",
  ".tar",
  ".tgz",
  ".tar.gz",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".exe",
  ".dmg",
  ".pkg",
  ".msi",
  ".war",
  ".ear",
  ".bin",
  ".dat",
  ".dump",
];

const largeFileIgnoredDirs: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ...subdirArtifactDirs,
]);

function isLargeFileIgnoredPath(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, "/").split("/");
  if (segments.length < 2) {
    return false;
  }
  const firstSegment = segments[0];
  return rootOnlyArtifactDirs.includes(firstSegment as (typeof rootOnlyArtifactDirs)[number]);
}

function isCsvDataFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return (
    lower.endsWith(".csv") ||
    lower.endsWith(".tsv") ||
    lower.endsWith(".jsonl") ||
    lower.endsWith(".ndjson") ||
    lower.endsWith(".parquet")
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

interface ScannedFile {
  path: string;
  size: number;
  isCsvData: boolean;
}

function anyWorkflowHasSparseCheckout(workflows: WorkflowDocument[]): boolean {
  return workflows.some((w) => w.source!.includes("sparse-checkout"));
}

const gitTrackedFilesCache = new Map<string, Promise<string[] | null>>();

async function getGitTrackedFiles(repoRoot: string): Promise<string[] | null> {
  const cached = gitTrackedFilesCache.get(repoRoot);
  if (cached !== undefined) {
    return cached;
  }
  const promise = (async (): Promise<string[] | null> => {
    try {
      const proc = spawn("git", ["-C", repoRoot, "ls-files", "-z"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      for await (const chunk of proc.stdout) {
        chunks.push(chunk);
      }
      const stdout = Buffer.concat(chunks).toString("utf8");
      const exitCode = await new Promise<number>((resolve) => {
        proc.on("close", resolve);
      });
      return exitCode !== 0 || !stdout ? null : stdout.split("\0").filter(Boolean);
    } catch {
      return null;
    }
  })();
  gitTrackedFilesCache.set(repoRoot, promise);
  return promise;
}

export async function collectLargeFileDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const ctx = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  if (repository.workflowCount === 0 || !repository.primaryWorkflowPath) {
    return [];
  }

  const isLargeFile = (p: string) => largeFileSuffixes.some((s) => p.toLowerCase().endsWith(s));

  const gitFiles = await getGitTrackedFiles(repoRoot);
  let candidates: string[] = gitFiles
    ? gitFiles.filter(isLargeFile)
    : await ctx.walkFiles(".", {
        cacheKey: "large-files-scan",
        ignoredDirectories: largeFileIgnoredDirs,
        include: isLargeFile,
      });

  candidates = candidates.filter((p) => !isLargeFileIgnoredPath(p));

  if (candidates.length === 0) {
    return [];
  }

  const scanned: ScannedFile[] = [];
  const CHUNK = 64;

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(async (file) => {
        try {
          const stats = await stat(ctx.resolve(file));
          if (stats.isFile() && stats.size > 0) {
            return {
              path: file,
              size: stats.size,
              isCsvData: isCsvDataFile(file),
            } satisfies ScannedFile;
          }
        } catch {
          // skip files that can't be stat'd
        }
        return null;
      }),
    );
    for (const r of results) {
      if (r) {
        scanned.push(r);
      }
    }
  }

  const csvDataFiles = scanned.filter((f) => f.isCsvData);
  const binaryFiles = scanned.filter((f) => !f.isCsvData);
  const csvDataTotal = csvDataFiles.reduce((sum, f) => sum + f.size, 0);
  const binaryTotal = binaryFiles.reduce((sum, f) => sum + f.size, 0);
  const cumulativeSize = csvDataTotal + binaryTotal;

  if (cumulativeSize < 10 * 1024 * 1024) {
    return [];
  }

  const sorted = [...scanned].sort((a, b) => b.size - a.size);
  const top5 = sorted.slice(0, 5);
  const top5List = top5.map((f) => `${f.path} (${formatSize(f.size)})`).join(", ");

  const hasSparseCheckout = anyWorkflowHasSparseCheckout(workflows);
  const parts: string[] = [];

  if (csvDataTotal > 0) {
    parts.push(`${formatSize(csvDataTotal)} in CSV/data files`);
  }
  if (binaryTotal > 0) {
    parts.push(`${formatSize(binaryTotal)} in archives/binaries`);
  }
  const sizeBreakdown = parts.join(", ");

  const sparseMsg = hasSparseCheckout
    ? "Sparse checkout is already configured in some workflows."
    : "Sparse checkout is not configured in any workflow.";

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: ".",
        line: 1,
        column: 1,
      },
      message: `Repository contains ${formatSize(cumulativeSize)} of large data and binary files (${sizeBreakdown}). Top 5: ${top5List}. ${sparseMsg}`,
      why: "Large data files (CSV, JSONL, Parquet) and binary files (archives, PDFs, installers) bloat git clone and checkout times in CI, increasing pull, checkout, and storage costs for every job.",
      suggestion: hasSparseCheckout
        ? "Review the flagged large files and consider removing unnecessary ones from version control, or migrating them to Git LFS for files that must remain tracked."
        : "Review the flagged large files and consider: 1) removing unnecessary files from version control, 2) migrating to Git LFS for files that must remain tracked, 3) adding `sparse-checkout` entries to `actions/checkout@` steps so CI jobs only fetch needed paths.",
      measurementHint:
        "Compare git clone and checkout wall-clock time before and after removing large files or adding sparse-checkout.",
      aiHandoff: `Review the following large files in the repository: ${top5List}. The repository has ${formatSize(cumulativeSize)} of large data and binary files. ${sparseMsg} Evaluate each file for removal, LFS migration, or checkout exclusion via sparse-checkout.`,
      score: cumulativeSize > 100 * 1024 * 1024 ? 92 : cumulativeSize > 50 * 1024 * 1024 ? 85 : 72,
    }),
  ];
}
