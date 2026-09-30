import type { RepositoryDiagnosticCollector } from "./collector-types.ts";
import { gateKeys } from "./gates.ts";
import { collectCdkBucketDeploymentMemoryDiagnostics } from "./cdk-bucket-deployment-memory.ts";
import { collectCdkAssetWasteFilesDiagnostics } from "./cdk-asset-waste-files.ts";
import { collectCdkAssetBuildConcurrencyDiagnostics } from "./cdk-asset-build-concurrency.ts";
import { collectCdkDuplicateAssetHashDiagnostics } from "./cdk-duplicate-asset-hash.ts";
import {
  collectCdkLibVersionDiagnostics,
  collectCdkOfflineValidationDiagnostics,
  collectCdkVersionReportingDiagnostics,
} from "./cdk-version-policy.ts";

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
    id: "prefer-cdk-asset-build-concurrency",
    gate: gateKeys.javascriptTooling,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectCdkAssetBuildConcurrencyDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
  {
    id: "prefer-aws-cdk-lib-2-267",
    gate: gateKeys.javascriptTooling,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectCdkLibVersionDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-aws-cdk-lib-offline-validation",
    gate: gateKeys.javascriptTooling,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectCdkOfflineValidationDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-cdk-version-reporting-disabled",
    gate: gateKeys.javascriptTooling,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectCdkVersionReportingDiagnostics(repoRoot, repository, warnings, scanContext),
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
