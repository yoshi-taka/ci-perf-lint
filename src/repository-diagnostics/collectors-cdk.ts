import type { RepositoryDiagnosticCollector } from "./collector-types.ts";
import { collectCdkBucketDeploymentMemoryDiagnostics } from "./cdk-bucket-deployment-memory.ts";
import { collectCdkAssetWasteFilesDiagnostics } from "./cdk-asset-waste-files.ts";
import { collectCdkDuplicateAssetHashDiagnostics } from "./cdk-duplicate-asset-hash.ts";

export const cdkDiagnosticCollectors = [
  {
    id: "cdk-bucket-deployment-memory-unconfigured",
    gate: "javascript-tooling",
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
    gate: "cdk-manifest",
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectCdkAssetWasteFilesDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
  {
    id: "cdk-duplicate-asset-hash",
    gate: "cdk-manifest",
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
