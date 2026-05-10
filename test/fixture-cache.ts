import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { ReportData } from "../src/types.ts";

const CACHE_DIR = path.resolve(import.meta.dir, "..", ".fixture-cache");
const FIXTURE_CACHE_SCHEMA_VERSION = 4;

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

const rootFingerprintCandidates = [
  "package.json",
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "uv.lock",
  "poetry.lock",
  "Cargo.lock",
  "Cargo.toml",
  "build.gradle",
  "build.gradle.kts",
  "Dockerfile",
  ".dockerignore",
  "pyproject.toml",
  "settings.gradle",
  "settings.gradle.kts",
  "requirements.txt",
  "requirements-dev.txt",
  "requirements-test.txt",
  "requirements-ci.txt",
  "requirements/base.txt",
  "requirements/dev.txt",
  "requirements/test.txt",
  "requirements/ci.txt",
  "tsconfig.json",
  "tsconfig.base.json",
  "jest.config.js",
  "jest.config.cjs",
  "jest.config.ts",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
  ".eslintrc.js",
  ".eslintrc.cjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
  "prettier.config.cts",
  "prettier.config.mts",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.cts",
  "tailwind.config.mts",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
  "postcss.config.mts",
  "renovate.json",
  "renovate.json5",
  ".github/renovate.json",
  ".github/renovate.json5",
] as const;

async function statFingerprintEntry(
  dir: string,
  relativePath: string,
  output: string[],
): Promise<void> {
  try {
    const stats = await stat(path.join(dir, relativePath));
    if (!stats.isFile()) {
      return;
    }
    output.push(`${relativePath}:${stats.size}:${stats.mtimeMs}`);
  } catch {
    return;
  }
}

async function collectWorkflowFingerprintEntries(
  dir: string,
  currentRelativeDir: string,
  output: string[],
): Promise<void> {
  const absoluteDir = path.join(dir, currentRelativeDir);
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of sortedEntries) {
    const relativePath = path.posix.join(currentRelativeDir, entry.name);
    if (entry.isDirectory()) {
      await collectWorkflowFingerprintEntries(dir, relativePath, output);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!/\.ya?ml$/i.test(entry.name)) {
      continue;
    }
    await statFingerprintEntry(dir, relativePath, output);
  }
}

async function fixtureFingerprint(dir: string): Promise<string> {
  const fingerprintEntries: string[] = [];

  await collectWorkflowFingerprintEntries(dir, ".github/workflows", fingerprintEntries);
  await Promise.all(
    rootFingerprintCandidates.map((relativePath) =>
      statFingerprintEntry(dir, relativePath, fingerprintEntries),
    ),
  );

  fingerprintEntries.sort();
  return createHash("sha256").update(fingerprintEntries.join("|")).digest("hex");
}

export function fixtureCacheKey(options: CacheOptions): string {
  return JSON.stringify([
    FIXTURE_CACHE_SCHEMA_VERSION,
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
