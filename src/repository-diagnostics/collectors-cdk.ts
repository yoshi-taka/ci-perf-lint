import type { RepositoryDiagnosticCollector } from "./collector-types.ts";
import { gateKeys } from "./gates.ts";
import { collectCdkBucketDeploymentMemoryDiagnostics } from "./cdk-bucket-deployment-memory.ts";
import { collectCdkAssetWasteFilesDiagnostics } from "./cdk-asset-waste-files.ts";
import { collectCdkDuplicateAssetHashDiagnostics } from "./cdk-duplicate-asset-hash.ts";

export const cdkDiagnosticCollectors = [
  {
    id: "cdk-bucket-deployment-memory-unconfigured",
    gate: gateKeys.javascriptTooling,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectCdkBucketDeploymentMemoryDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
  {
    id: "cdk-asset-waste-files",
    gate: gateKeys.cdkManifest,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectCdkAssetWasteFilesDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
  {
    id: "cdk-duplicate-asset-hash",
    gate: gateKeys.cdkManifest,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectCdkDuplicateAssetHashDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
] satisfies readonly RepositoryDiagnosticCollector[];
