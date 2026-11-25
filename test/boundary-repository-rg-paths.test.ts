import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

async function isolatedContext(rgPath: string | null, useBun: boolean) {
  const filename = fileURLToPath(new URL("../src/repository-scan-context.ts", import.meta.url));
  const source = await Bun.file(filename).text();
  // rg spawns directly after the which-probe removal, so inject the fake binary
  // at both call sites. A null rgPath injects a nonexistent path: Bun.spawn
  // throws and the node branch emits an "error" event, exercising the ENOENT
  // fallback instead of the former probe-absence short circuit.
  const injected = rgPath ?? path.join(path.sep, "apl-definitely-missing", "rg");
  const changed = source
    .replace(
      'Bun.spawn(["rg", "--files", "--hidden", repoRoot]',
      `Bun.spawn([${JSON.stringify(injected)}, "--files", "--hidden", repoRoot]`,
    )
    .replace(
      'spawn("rg", ["--files", "--hidden", repoRoot]',
      `spawn(${JSON.stringify(injected)}, ["--files", "--hidden", repoRoot]`,
    );
  expect(changed).not.toBe(source);
  const build = await Bun.build({
    entrypoints: [filename],
    target: "bun",
    plugins: [
      {
        name: "isolated-rg-path",
        setup(builder) {
          builder.onLoad({ filter: /\/repository-scan-context\.ts$/ }, () => ({
            contents: changed,
            loader: "ts",
          }));
          builder.onLoad({ filter: /\/bun\.ts$/ }, () => ({
            contents: `export const hasBun = ${useBun};`,
            loader: "ts",
          }));
        },
      },
    ],
  });
  expect(build.success).toBe(true);
  const bundled = await build.outputs[0]!.text();
  const module = (await import(
    `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`
  )) as {
    RepositoryScanContext: typeof RepositoryScanContext;
  };
  return module.RepositoryScanContext;
}

test.each([false, true])(
  "rg mapping preserves paths and caller filters (Bun spawn: %s)",
  async (useBun) => {
    const repoRoot = await tempDirs.create("relative-rg-paths-");
    // Keep this scanner-specific fixture out of the small-tree walker fast path.
    await mkdir(path.join(repoRoot, ".git"));
    const rgPath = path.join(repoRoot, "fake-rg");
    const raw = ["src/z.ts", "src/./a.ts", "src//b.ts", "skip/c.ts", "node_modules/d.ts"];
    const lines = raw
      .map((file) => `'${`${repoRoot}/${file}`.replaceAll("'", "'\\''")}'`)
      .join(" ");
    await writeFile(rgPath, `#!/bin/sh\nprintf '%s\\n' ${lines}\n`, { mode: 0o755 });
    const Context = await isolatedContext(rgPath, useBun);
    for (const root of [repoRoot, `${repoRoot}/`]) {
      const context = new Context(root, []);
      expect(await context.walkFiles(".")).toEqual([
        "skip/c.ts",
        "src/a.ts",
        "src/b.ts",
        "src/z.ts",
      ]);
      expect(await context.walkFiles("src")).toEqual(["src/a.ts", "src/b.ts", "src/z.ts"]);
      expect(
        await context.walkFiles(".", {
          ignoredDirectories: new Set(["skip"]),
          include: (file) => file.endsWith("a.ts"),
        }),
      ).toEqual(["src/a.ts"]);
      expect(context.warnings).toEqual([]);
    }
  },
);

test.each([false, true])(
  "rg error and ENOENT retain readdir fallback (Bun spawn: %s)",
  async (useBun) => {
    const repoRoot = await tempDirs.create("relative-rg-fallback-");
    // Otherwise the small-tree walker succeeds without exercising rg failure.
    await mkdir(path.join(repoRoot, ".git"));
    await mkdir(path.join(repoRoot, "src"));
    await mkdir(path.join(repoRoot, "node_modules"));
    await writeFile(path.join(repoRoot, "src", "a.ts"), "");
    await writeFile(path.join(repoRoot, "node_modules", "hidden.ts"), "");
    const rgPath = path.join(repoRoot, "fake-rg");
    await writeFile(rgPath, "#!/bin/sh\nexit 2\n", { mode: 0o755 });
    // rgPath exits nonzero; null resolves to a nonexistent path (ENOENT).
    for (const executable of [rgPath, null]) {
      const Context = await isolatedContext(executable, useBun);
      const context = new Context(repoRoot, []);
      expect(await context.walkFiles("src")).toEqual(["src/a.ts"]);
      expect((await context.walkFiles(".")).sort()).toEqual(["fake-rg", "src/a.ts"]);
      expect(context.warnings).toEqual([]);
    }
  },
);
