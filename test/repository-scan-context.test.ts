import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("RepositoryScanContext", () => {
  test("caches package.json parsing by package path within a scan", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-");
    const workspaceDir = path.join(repoRoot, "packages", "app");
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ name: "root" }));
    await writeFile(path.join(workspaceDir, "package.json"), JSON.stringify({ name: "workspace" }));

    const context = new RepositoryScanContext(repoRoot, []);
    const rootPackage = await context.loadPackageJson();
    const workspacePackage = await context.loadPackageJson("packages/app/package.json");

    await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ name: "changed" }));

    expect((await context.loadPackageJson()).value?.name).toBe("root");
    expect(rootPackage).toBe(await context.loadPackageJson());
    expect(workspacePackage.value?.name).toBe("workspace");
  });

  test("loads package.json by absolute path and caches the parsed entry", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-absolute-");
    const packageJsonPath = path.join(repoRoot, "custom-package.json");
    await writeFile(packageJsonPath, JSON.stringify({ name: "absolute" }));

    const context = new RepositoryScanContext(repoRoot, []);
    const firstLoad = await context.loadPackageJson(packageJsonPath);

    await writeFile(packageJsonPath, JSON.stringify({ name: "changed" }));

    expect(firstLoad.path).toBe(packageJsonPath);
    expect(firstLoad.value?.name).toBe("absolute");
    expect(await context.loadPackageJson(packageJsonPath)).toBe(firstLoad);
    expect(context.warnings).toHaveLength(0);
  });

  test("returns an empty entry without warning when package.json is missing", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-missing-");
    const context = new RepositoryScanContext(repoRoot, []);

    const entry = await context.loadPackageJson();

    expect(entry).toEqual({ path: path.join(repoRoot, "package.json") });
    expect(context.warnings).toHaveLength(0);
  });

  test("caches path existence and text file reads within a scan", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-fs-cache-");
    const filePath = path.join(repoRoot, "README.md");
    const missingPath = path.join(repoRoot, "missing.txt");
    await writeFile(filePath, "first\n");

    const context = new RepositoryScanContext(repoRoot, []);

    expect(await context.pathExists(filePath)).toBe(true);
    expect(await context.pathExists(missingPath)).toBe(false);
    expect(await context.readTextFileOrWarn(filePath)).toBe("first\n");

    await writeFile(filePath, "second\n");

    expect(await context.pathExists(filePath)).toBe(true);
    expect(await context.pathExists(missingPath)).toBe(false);
    expect(await context.readTextFileOrWarn(filePath)).toBe("first\n");
    expect(context.warnings).toHaveLength(0);
  });

  test("caches directory entries within a scan", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-dir-cache-");
    await writeFile(path.join(repoRoot, "first.txt"), "one\n");

    const context = new RepositoryScanContext(repoRoot, []);
    const firstEntries = await context.readDirectoryEntries(repoRoot);

    await writeFile(path.join(repoRoot, "second.txt"), "two\n");

    const secondEntries = await context.readDirectoryEntries(repoRoot);

    expect(firstEntries).toBe(secondEntries);
    expect(firstEntries.map((entry) => entry.name)).toContain("first.txt");
    expect(firstEntries.map((entry) => entry.name)).not.toContain("second.txt");
  });

  test("walkFiles filters by subdirectory prefix correctly", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-subdir-");
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await mkdir(path.join(repoRoot, "src", "lib"), { recursive: true });
    await mkdir(path.join(repoRoot, "test"), { recursive: true });
    await writeFile(path.join(repoRoot, "README.md"), "root\n");
    await writeFile(path.join(repoRoot, "src", "index.ts"), "export {};\n");
    await writeFile(path.join(repoRoot, "src", "lib", "util.ts"), "export {};\n");
    await writeFile(path.join(repoRoot, "test", "index.test.ts"), "test;\n");

    const context = new RepositoryScanContext(repoRoot, []);
    const rootFiles = await context.walkFiles(".");
    const srcFiles = await context.walkFiles("src");
    const srcLibFiles = await context.walkFiles("src/lib");

    expect(rootFiles.sort()).toEqual([
      "README.md",
      "src/index.ts",
      "src/lib/util.ts",
      "test/index.test.ts",
    ]);
    expect(srcFiles.sort()).toEqual(["src/index.ts", "src/lib/util.ts"]);
    expect(srcLibFiles.sort()).toEqual(["src/lib/util.ts"]);
  });

  test("walkFiles subdirectory results are cached", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-subdir-cache-");
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(path.join(repoRoot, "src", "index.ts"), "export {};\n");

    const context = new RepositoryScanContext(repoRoot, []);

    const first = await context.walkFiles("src");
    await writeFile(path.join(repoRoot, "src", "added.ts"), "export {};\n");
    const second = await context.walkFiles("src");

    expect(first).toBe(second);
    expect(first).toEqual(["src/index.ts"]);
  });

  test("caches walkFiles results by explicit cache key within a scan", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-walk-cache-");
    await writeFile(path.join(repoRoot, "first.snap"), "one\n");

    const context = new RepositoryScanContext(repoRoot, []);
    const includeSnapshots = (relativePath: string) => relativePath.endsWith(".snap");
    const firstFiles = await context.walkFiles(".", {
      cacheKey: "snapshot-files",
      include: includeSnapshots,
    });

    await writeFile(path.join(repoRoot, "second.snap"), "two\n");

    const secondFiles = await context.walkFiles(".", {
      cacheKey: "snapshot-files",
      include: (relativePath) => relativePath.endsWith(".snap"),
    });

    expect(firstFiles).toBe(secondFiles);
    expect(firstFiles).toEqual(["first.snap"]);
  });

  test("keeps raw text and records a warning for invalid package.json", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-invalid-");
    const packageJsonPath = path.join(repoRoot, "package.json");
    await writeFile(packageJsonPath, '{"name": "broken"\n');

    const context = new RepositoryScanContext(repoRoot, []);
    const entry = await context.loadPackageJson();

    expect(entry.path).toBe(packageJsonPath);
    expect(entry.text).toBe('{"name": "broken"\n');
    expect(entry.value).toBeUndefined();
    expect(context.warnings).toHaveLength(1);
    expect(context.warnings[0]?.source).toBe(packageJsonPath);
    expect(context.warnings[0]?.message).toContain(
      "Failed to parse JSON while collecting repository signals",
    );
  });

  test("records a warning when package.json is valid JSON but not an object", async () => {
    const repoRoot = await tempDirs.create("actions-perf-context-array-");
    const packageJsonPath = path.join(repoRoot, "package.json");
    await writeFile(packageJsonPath, "[]\n");

    const context = new RepositoryScanContext(repoRoot, []);
    const entry = await context.loadPackageJson();

    expect(entry.text).toBe("[]\n");
    expect(entry.value).toBeUndefined();
    expect(context.warnings).toEqual([
      {
        kind: "scan-warning",
        source: packageJsonPath,
        message: "Expected a JSON object while collecting repository signals.",
      },
    ]);
  });
});
