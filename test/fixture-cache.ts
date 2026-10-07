import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { ReportData } from "../src/types.ts";

const repoRoot = path.resolve(import.meta.dir, "..");
const CACHE_DIR = path.join(repoRoot, ".fixture-cache");
const FIXTURE_CACHE_SCHEMA_VERSION = 5;
const ignoredDirectories = new Set([".git", "node_modules", ".fixture-cache", "dist", "build"]);

interface CacheEntry {
  key: string;
  fingerprint: string;
  data: ReportData;
}

interface CacheOptions {
  cwd: string;
  targetPath: string;
  topCount?: number;
  mode?: string;
  workflowOnly?: boolean;
  repositoryOnly?: boolean;
}

async function fingerprintTree(dir: string, relativeDir: string, entries: string[]): Promise<void> {
  const children = await readdir(path.join(dir, relativeDir), { withFileTypes: true }).catch(
    () => [],
  );
  await Promise.all(
    children.map(async (child) => {
      const relativePath = path.posix.join(relativeDir, child.name);
      if (child.isDirectory()) {
        if (!ignoredDirectories.has(child.name)) {
          await fingerprintTree(dir, relativePath, entries);
        }
      } else if (child.isFile()) {
        const filePath = path.join(dir, relativePath);
        const info = await stat(filePath);
        const identity =
          info.size <= 1024 * 1024
            ? createHash("sha256")
                .update(await readFile(filePath))
                .digest("hex")
            : `${info.size}:${info.mtimeMs}`;
        entries.push(`${relativePath}:${identity}`);
      }
    }),
  );
}

let sourceFingerprint: Promise<string> | undefined;
function fingerprintSource(): Promise<string> {
  sourceFingerprint ??= (async () => {
    const entries: string[] = [];
    await fingerprintTree(repoRoot, "src", entries);
    for (const file of ["package.json", "bun.lock"]) {
      entries.push(
        `${file}:${createHash("sha256")
          .update(await readFile(path.join(repoRoot, file)))
          .digest("hex")}`,
      );
    }
    return createHash("sha256").update(entries.sort().join("|")).digest("hex");
  })();
  return sourceFingerprint;
}

export async function fixtureFingerprint(dir: string): Promise<string> {
  const entries: string[] = [];
  await fingerprintTree(dir, "", entries);
  entries.push(await fingerprintSource());
  return createHash("sha256").update(entries.sort().join("|")).digest("hex");
}

export function fixtureCacheKey(options: CacheOptions): string {
  return JSON.stringify([
    FIXTURE_CACHE_SCHEMA_VERSION,
    options.cwd,
    options.targetPath,
    options.mode ?? "strict",
    options.workflowOnly ?? false,
    options.repositoryOnly ?? false,
    options.topCount ?? 20,
    process.env.AGENT ?? "",
    process.env.CI_PERF_LINT_DISABLE_OXLINT ?? "",
    process.env.CI_PERF_LINT_SHARED_DIAGNOSTICS ?? "",
  ]);
}

function parseCwdFromKey(key: string): string {
  const values: unknown = JSON.parse(key);
  if (
    !Array.isArray(values) ||
    values[0] !== FIXTURE_CACHE_SCHEMA_VERSION ||
    typeof values[1] !== "string"
  ) {
    throw new Error("Invalid fixture cache key");
  }
  return values[1];
}

function cacheFilePath(key: string): string {
  return path.join(
    CACHE_DIR,
    `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.json`,
  );
}

export async function loadFixtureCache(key: string): Promise<ReportData | null> {
  try {
    const entry = JSON.parse(await readFile(cacheFilePath(key), "utf8")) as CacheEntry;
    if (
      entry.key !== key ||
      entry.fingerprint !== (await fixtureFingerprint(parseCwdFromKey(key)))
    ) {
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function saveFixtureCache(
  key: string,
  data: ReportData,
  inputFingerprint?: string,
): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const entry: CacheEntry = {
    key,
    fingerprint: inputFingerprint ?? (await fixtureFingerprint(parseCwdFromKey(key))),
    data,
  };
  await writeFile(cacheFilePath(key), JSON.stringify(entry));
}
