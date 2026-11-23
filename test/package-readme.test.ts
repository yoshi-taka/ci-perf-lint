import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { syncPackageReadme } from "../scripts/sync-package-readme";
import { testTempRoot } from "./temp-root";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("package README sync preserves one source and detects drift without mutating in check mode", async () => {
  const root = await mkdtemp(path.join(testTempRoot(), "package-readme-"));
  roots.push(root);
  await mkdir(path.join(root, "packages/ci-perf-lint"), { recursive: true });
  const source = path.join(root, "README.md");
  const target = path.join(root, "packages/ci-perf-lint/README.md");
  await writeFile(source, "# Product\n\nCurrent.\n");
  await writeFile(target, "# Old\n");
  const error = await syncPackageReadme(root, true).catch((value: unknown) => value);
  expect(String(error)).toContain("out of sync");
  expect(await readFile(target, "utf8")).toBe("# Old\n");
  await syncPackageReadme(root);
  expect(await readFile(target, "utf8")).toBe(await readFile(source, "utf8"));
  await syncPackageReadme(root, true);
  await writeFile(source, "# Updated\n");
  expect(String(await syncPackageReadme(root, true).catch((value: unknown) => value))).toContain(
    "out of sync",
  );
});

test("published READMEs match, use portable links, and keep example lines within 64 columns", async () => {
  const root = path.resolve(import.meta.dir, "..");
  await syncPackageReadme(root, true);
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  expect(readme).toContain('src="https://raw.githubusercontent.com/');
  expect(readme).not.toMatch(/(?:src|href)="\.|\]\((?:\.\/)?docs\//);
  for (const block of readme.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of (block[1] ?? "").split("\n")) {
      expect(line.length).toBeLessThanOrEqual(64);
    }
  }
});
