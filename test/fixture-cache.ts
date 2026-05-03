import { mkdir, readFile, stat, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { ReportData } from "../src/types.ts";

const CACHE_DIR = path.resolve(import.meta.dir, "..", ".fixture-cache");

interface CacheEntry {
  key: string;
  fingerprint: string;
  data: ReportData;
}

interface CacheOptions {
  cwd: string;
  targetPath: string;
  mode?: string;
  workflowOnly?: boolean;
  repositoryOnly?: boolean;
}

async function fixtureFingerprint(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  let totalSize = 0;
  let count = 0;
  for (const entry of entries) {
    if (entry.isFile() || entry.isDirectory()) {
      const s = await stat(path.join(dir, entry.name));
      totalSize += s.size;
      count++;
    }
  }
  return `${count}:${totalSize}`;
}

export function fixtureCacheKey(options: CacheOptions): string {
  return JSON.stringify([
    options.cwd,
    options.targetPath,
    options.mode ?? "strict",
    options.workflowOnly ?? false,
    options.repositoryOnly ?? false,
  ]);
}

function parseCwdFromKey(key: string): string {
  return JSON.parse(key)[0] as string;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function cacheFilePath(key: string): string {
  return path.join(CACHE_DIR, `${hashKey(key)}.json`);
}

export async function loadFixtureCache(key: string): Promise<ReportData | null> {
  try {
    const raw = await readFile(cacheFilePath(key), "utf8");
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.key !== key) {
      return null;
    }

    const fp = await fixtureFingerprint(parseCwdFromKey(key));
    if (entry.fingerprint !== fp) {
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

export async function saveFixtureCache(key: string, data: ReportData): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const fp = await fixtureFingerprint(parseCwdFromKey(key));
  const entry: CacheEntry = { key, fingerprint: fp, data };
  await writeFile(cacheFilePath(key), JSON.stringify(entry));
}
