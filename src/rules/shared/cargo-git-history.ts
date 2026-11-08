import path from "node:path";
import type { RepositoryScanContext } from "../../repository-scan-context.ts";

// Evidence only: a Cargo manifest alone does not establish a Git requirement.
export async function cargoBuildScriptReadsHistory(
  context: RepositoryScanContext,
  directory: string,
): Promise<boolean> {
  const manifestPath = path.join(directory, "Cargo.toml");
  if (!(await context.pathExists(manifestPath))) {
    return false;
  }
  const manifest = await context.readTextFileOrWarn(manifestPath);
  const packageSection = manifest?.match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  if (!packageSection || /^\s*build\s*=\s*false\b/m.test(packageSection)) {
    return false;
  }
  const buildFile = /^\s*build\s*=\s*["']([^"']+)["']/m.exec(packageSection)?.[1] ?? "build.rs";
  const buildPath = path.resolve(directory, buildFile);
  if (!buildPath.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    return false;
  }
  if (!(await context.pathExists(buildPath))) {
    return false;
  }
  const source = (await context.readTextFileOrWarn(buildPath))
    ?.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // Literal command arrays (including helper calls) or Command::new("git").args(...).
  return (
    /["']git["']\s*,\s*["'](?:describe|log|rev-list)["']/.test(source ?? "") ||
    /Command::new\("git"\)\s*\.args?\([^;]*"(?:describe|log|rev-list)"/.test(source ?? "")
  );
}
