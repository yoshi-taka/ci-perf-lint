import { fileURLToPath } from "node:url";
import path from "node:path";

let cachedOxlintBinPath: string | undefined;

export async function bundledOxlintBinPath(
  accessSync?: (p: string) => void,
  resolvePackage?: (spec: string) => string | URL | Promise<string | URL>,
): Promise<string | undefined> {
  if (cachedOxlintBinPath !== undefined && !accessSync && !resolvePackage) {
    return cachedOxlintBinPath;
  }

  const binaryName = process.platform === "win32" ? "oxlint.exe" : "oxlint";
  const startDir =
    (import.meta as { dir?: string }).dir ?? path.dirname(fileURLToPath(import.meta.url));
  const fsAccess = accessSync ?? require("node:fs").accessSync;
  const pkgResolve = resolvePackage ?? ((spec: string) => import.meta.resolve(spec));

  try {
    const pkgUrl = await pkgResolve("oxlint/package.json");
    const pkgRoot = path.dirname(fileURLToPath(pkgUrl instanceof URL ? pkgUrl : new URL(pkgUrl)));
    const binPath = path.resolve(pkgRoot, "bin", binaryName);
    fsAccess(binPath);
    cachedOxlintBinPath = binPath;
    return binPath;
  } catch {
    // fallback: walk up from startDir
  }

  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.resolve(dir, "node_modules", ".bin", binaryName);
    try {
      fsAccess(candidate);
      cachedOxlintBinPath = candidate;
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  cachedOxlintBinPath = undefined;
  return undefined;
}

export function bundledOxlintJsPath(binPath: string): string {
  const binDir = path.dirname(require("node:fs").realpathSync(binPath));
  return path.resolve(binDir, "..", "dist", "cli.js");
}
