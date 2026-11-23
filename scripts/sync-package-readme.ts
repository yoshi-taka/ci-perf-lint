import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function syncPackageReadme(
  rootDir = path.resolve(import.meta.dir, ".."),
  check = false,
): Promise<void> {
  const source = await readFile(path.join(rootDir, "README.md"), "utf8");
  const target = path.join(rootDir, "packages/ci-perf-lint/README.md");
  if (check) {
    const current = await readFile(target, "utf8");
    if (current !== source) {
      throw new Error("Wrapper README is out of sync. Run bun run sync:package-readme.");
    }
  } else {
    await writeFile(target, source);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check"))
    throw new Error("Usage: sync-package-readme.ts [--check]");
  await syncPackageReadme(undefined, args.includes("--check"));
}
