import type { RepositoryDiagnosticContext } from "./collector-types.ts";

export type NodePackageManager = "pnpm" | "yarn" | "bun";

const lockfileByManager: readonly [NodePackageManager, string][] = [
  ["pnpm", "pnpm-lock.yaml"],
  ["yarn", "yarn.lock"],
  ["bun", "bun.lock"],
  ["bun", "bun.lockb"],
];

export async function detectNonNpmPackageManager(
  context: RepositoryDiagnosticContext,
): Promise<NodePackageManager | undefined> {
  const packageJson = await context.scanContext.loadPackageJson();
  const declared = packageJson.value?.packageManager;
  if (typeof declared === "string") {
    const name = declared.split("@")[0]?.toLowerCase();
    if (name === "pnpm" || name === "yarn" || name === "bun") {
      return name;
    }
    if (name === "npm") {
      return undefined;
    }
  }

  const hasNpmLock = await context.scanContext.pathExists(
    context.scanContext.resolve("package-lock.json"),
  );
  if (hasNpmLock) {
    return undefined;
  }

  for (const [manager, file] of lockfileByManager) {
    if (await context.scanContext.pathExists(context.scanContext.resolve(file))) {
      return manager;
    }
  }

  return undefined;
}
