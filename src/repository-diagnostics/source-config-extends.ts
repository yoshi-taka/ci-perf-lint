import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { readSourceConfig, sourcePath } from "./source-config.ts";

/** Read installed package JSON/config data only, never require/import target code. */
export function configBaseResolver(context: RepositoryScanContext, inventory: ReadonlySet<string>) {
  const cache = new Map<string, Promise<string | undefined>>();
  let root: Promise<string> | undefined;
  let reads = 0;
  async function safeFile(candidate: string): Promise<string | undefined> {
    if (!/\.jsonc?$/.test(candidate) || !(await context.pathExists(context.resolve(candidate)))) {
      return undefined;
    }
    try {
      const [canonical, info, canonicalRoot] = await Promise.all([
        realpath(context.resolve(candidate)),
        stat(context.resolve(candidate)),
        (root ??= realpath(context.repoRoot)),
      ]);
      return info.isFile() && canonical.startsWith(canonicalRoot + path.sep)
        ? candidate
        : undefined;
    } catch {
      return undefined;
    }
  }
  return (directory: string, request: string): Promise<string | undefined> => {
    const key = `${directory}\0${request}`;
    let result = cache.get(key);
    if (result) {
      return result;
    }
    result = (async () => {
      if (request.startsWith(".")) {
        const base = sourcePath(directory, request);
        if (!base) {
          return undefined;
        }
        if (inventory.has(base)) {
          return safeFile(base);
        }
        return (await safeFile(base)) ?? (await safeFile(`${base}.json`));
      }
      const parts = request.split("/");
      if (
        !request ||
        /^[a-z][\w+.-]*:/i.test(request) ||
        parts.some((part) => !part || part === "." || part === "..") ||
        request.includes("\\")
      ) {
        return undefined;
      }
      const count = request.startsWith("@") ? 2 : 1;
      if (parts.length < count) {
        return undefined;
      }
      let current = directory;
      for (;;) {
        const packageDir = sourcePath(current, `node_modules/${parts.slice(0, count).join("/")}`);
        if (!packageDir) {
          return undefined;
        }
        if (parts.length > count) {
          const target = sourcePath(packageDir, parts.slice(count).join("/"));
          if (target) {
            const file = (await safeFile(target)) ?? (await safeFile(`${target}.json`));
            if (file) {
              return file;
            }
          }
        } else {
          const manifestFile = await safeFile(`${packageDir}/package.json`);
          if (manifestFile && reads++ < 512) {
            const manifest = await readSourceConfig(context, manifestFile, false);
            const target = sourcePath(
              packageDir,
              typeof manifest?.tsconfig === "string" ? manifest.tsconfig : "tsconfig.json",
            );
            if (target) {
              return (await safeFile(target)) ?? (await safeFile(`${target}.json`));
            }
            return undefined;
          }
        }
        if (current === ".") {
          return undefined;
        }
        current = path.posix.dirname(current);
      }
    })();
    cache.set(key, result);
    return result;
  };
}
