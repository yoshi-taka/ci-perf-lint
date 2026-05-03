import path from "node:path";
import { readdir } from "node:fs/promises";
import { analyzeRepository } from "../src/repo.ts";
import { fixtureCacheKey, saveFixtureCache } from "../test/fixture-cache.ts";

const fixturesDir = path.resolve(import.meta.dir, "..", "test", "fixtures");
const modes = ["strict", "exploratory"] as const;

async function main() {
  const entries = await readdir(fixturesDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(fixturesDir, e.name));
  let cached = 0;
  let computed = 0;

  for (const dir of dirs) {
    for (const mode of modes) {
      const key = fixtureCacheKey({ cwd: dir, targetPath: ".", mode });

      const existing = await loadCached(key);
      if (existing) {
        cached++;
        continue;
      }

      const result = await analyzeRepository({ cwd: dir, targetPath: ".", topCount: 20, mode });
      await saveFixtureCache(key, result);
      computed++;
      process.stderr.write(`cached ${path.basename(dir)} (${mode})\n`);
    }
  }

  console.log(
    `Cached ${computed} new entries (${cached} already cached, ${dirs.length} dirs × ${modes.length} modes)`,
  );
}

async function loadCached(key: string): Promise<boolean> {
  const { loadFixtureCache } = await import("../test/fixture-cache.ts");
  const data = await loadFixtureCache(key);
  return data !== null;
}

main().catch(console.error);
