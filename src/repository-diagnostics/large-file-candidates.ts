import { spawn } from "node:child_process";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { rootOnlyArtifactDirs, subdirArtifactDirs } from "./waste-patterns.ts";

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
] as const;

const gateIgnoredDirs: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);

const collectorIgnoredDirs: ReadonlySet<string> = new Set([
  ...gateIgnoredDirs,
  ...subdirArtifactDirs,
]);

function isLargeFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return largeFileSuffixes.some((suffix) => lower.endsWith(suffix));
}

function isCollectorIgnoredPath(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, "/").split("/");
  return (
    segments.length >= 2 &&
    rootOnlyArtifactDirs.includes(segments[0] as (typeof rootOnlyArtifactDirs)[number])
  );
}

async function getGitTrackedFiles(repoRoot: string): Promise<string[] | null> {
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
}

export interface LargeFileCandidateIndex {
  gate(): Promise<string[]>;
  collector(): Promise<string[]>;
}

const indexes = new WeakMap<RepositoryScanContext, LargeFileCandidateIndex>();

export function largeFileCandidateIndex(
  scanContext: RepositoryScanContext,
): LargeFileCandidateIndex {
  const existing = indexes.get(scanContext);
  if (existing) {
    return existing;
  }

  let gate: Promise<string[]> | undefined;
  let collector: Promise<string[]> | undefined;
  const index = {
    gate: () =>
      (gate ??= scanContext.walkFiles(".", {
        cacheKey: "large-file-gate-candidates",
        ignoredDirectories: gateIgnoredDirs,
        include: isLargeFile,
      })),
    collector: () =>
      (collector ??= (async () => {
        const tracked = await getGitTrackedFiles(scanContext.repoRoot);
        const candidates = tracked
          ? tracked.filter(isLargeFile)
          : await scanContext.walkFiles(".", {
              cacheKey: "large-file-collector-candidates",
              ignoredDirectories: collectorIgnoredDirs,
              include: isLargeFile,
            });
        return candidates.filter((candidate) => !isCollectorIgnoredPath(candidate));
      })()),
  } satisfies LargeFileCandidateIndex;
  indexes.set(scanContext, index);
  return index;
}
