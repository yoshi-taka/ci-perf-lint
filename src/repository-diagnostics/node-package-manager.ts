import { detectPackageManager, type NodePackageManager } from "../repository-package-helpers.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";

export type { NodePackageManager };

export async function detectNonNpmPackageManager(
  context: RepositoryDiagnosticContext,
): Promise<NodePackageManager | undefined> {
  const manager = await detectPackageManager(context.scanContext);
  return manager === "npm" ? undefined : manager;
}
