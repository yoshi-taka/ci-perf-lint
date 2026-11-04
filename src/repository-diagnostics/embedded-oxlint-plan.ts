import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { EmbeddedOxlintScanPlan } from "./embedded-oxlint-config.ts";
import { shouldScanExplicitImportExtensions } from "./imports-shared.ts";

export async function buildEmbeddedOxlintScanPlan(
  collectorIds: readonly string[],
  repository: RepositorySignals,
  scanContext: RepositoryScanContext,
): Promise<EmbeddedOxlintScanPlan> {
  const collectors = new Set(collectorIds);
  return {
    importExtensions:
      collectors.has("prefer-explicit-import-extensions") &&
      (await shouldScanExplicitImportExtensions(repository, scanContext)),
    restrictedImports: collectors.has("restricted-import-diagnostics"),
    barrels: collectors.has("detected-large-barrel-file"),
    snapshots: collectors.has("large-jest-snapshot"),
  };
}
