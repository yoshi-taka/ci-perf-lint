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
  const changed = source.replace(
    "static #rgPath: string | null | undefined;",
    `static #rgPath: string | null | undefined = ${JSON.stringify(rgPath)};`,
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
        "src/z.ts",
        "src/a.ts",
        "src/b.ts",
        "skip/c.ts",
      ]);
      expect(await context.walkFiles("src")).toEqual(["src/z.ts", "src/a.ts", "src/b.ts"]);
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
  "rg error and absence retain readdir fallback (Bun spawn: %s)",
  async (useBun) => {
    const repoRoot = await tempDirs.create("relative-rg-fallback-");
    await mkdir(path.join(repoRoot, "src"));
    await mkdir(path.join(repoRoot, "node_modules"));
    await writeFile(path.join(repoRoot, "src", "a.ts"), "");
    await writeFile(path.join(repoRoot, "node_modules", "hidden.ts"), "");
    const rgPath = path.join(repoRoot, "fake-rg");
    await writeFile(rgPath, "#!/bin/sh\nexit 2\n", { mode: 0o755 });
    for (const executable of [rgPath, null]) {
      const Context = await isolatedContext(executable, useBun);
      const context = new Context(repoRoot, []);
      expect(await context.walkFiles("src")).toEqual(["src/a.ts"]);
      expect((await context.walkFiles(".")).sort()).toEqual(["fake-rg", "src/a.ts"]);
      expect(context.warnings).toEqual([]);
    }
  },
);
