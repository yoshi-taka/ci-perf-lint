import type {
  RepositoryDiagnosticCollector,
  RepositoryDiagnosticContext,
} from "./collector-types.ts";
import { gateKeys } from "./gates.ts";
import { collectDatadogLambdaExtensionDiagnostics } from "./datadog-lambda-extension.ts";
import { collectDockerBuildDiagnostics } from "./docker.ts";
import { collectDockerImageMetadataDiagnostics } from "./docker-image-metadata-diagnostics.ts";
import { collectDockerBuildRuntimeSeparationDiagnostics } from "./docker-build-runtime-separation.ts";
import { collectDockerRuntimeBaseImageDiagnostics } from "./docker-runtime-base-image.ts";
import { collectDockerfileChownAfterCopyDiagnostics } from "./dockerfile-chown-after-copy.ts";
import { collectDockerExtractsCopiedArchiveDiagnostics } from "./docker-extracts-copied-archive.ts";
import { collectDockerRuntimeCopiesBuilderRootfsDiagnostics } from "./docker-runtime-copies-builder-rootfs.ts";
import { collectElixirOtpVersionDiagnostics } from "./elixir-otp-versions.ts";
import { collectElixirParallelDepsCompileDiagnostics } from "./elixir-parallel-deps-compile.ts";
import { collectLargeFileDiagnostics } from "./large-files.ts";
import { collectPreferMiseOverAsdfDiagnostics } from "./prefer-mise-over-asdf.ts";

export const dockerDiagnosticCollectors = [
  {
    id: "docker-build-diagnostics",
    gate: gateKeys.dockerHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext, featureIndex }) =>
      collectDockerBuildDiagnostics(repoRoot, repository, workflows, {
        warnings,
        scanContext,
        featureIndex,
      }),
  },
  {
    id: "docker-image-metadata-diagnostics",
    gate: gateKeys.dockerHeavy,
    collect: collectDockerImageMetadataDiagnostics,
  },
  {
    id: "avoid-chown-after-copy-add",
    gate: gateKeys.dockerHeavy,
    collect: collectDockerfileChownAfterCopyDiagnostics,
  },
  {
    id: "dockerfile-extracts-copied-archive",
    gate: gateKeys.dockerHeavy,
    collect: collectDockerExtractsCopiedArchiveDiagnostics,
  },
  {
    id: "dockerfile-runtime-copies-builder-rootfs",
    gate: gateKeys.dockerHeavy,
    collect: collectDockerRuntimeCopiesBuilderRootfsDiagnostics,
  },
  {
    id: "dockerfile-runtime-image-uses-heavy-base",
    gate: gateKeys.dockerHeavy,
    collect: collectDockerRuntimeBaseImageDiagnostics,
  },
  {
    id: "dockerfile-runtime-inherits-build-environment",
    gate: gateKeys.dockerHeavy,
    collect: collectDockerBuildRuntimeSeparationDiagnostics,
  },
] satisfies readonly RepositoryDiagnosticCollector[];

export const largeFileDiagnosticCollectors = [
  {
    id: "detected-large-files",
    gate: gateKeys.largeFiles,
    collect: ({ repoRoot, repository, warnings, scanContext, featureIndex }) =>
      collectLargeFileDiagnostics(repoRoot, repository, warnings, scanContext, featureIndex),
  },
] satisfies readonly RepositoryDiagnosticCollector[];

export const datadogDiagnosticCollectors = [
  {
    id: "datadog-lambda-extension-diagnostics",
    gate: gateKeys.datadogHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectDatadogLambdaExtensionDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
] satisfies readonly RepositoryDiagnosticCollector[];

export const elixirDiagnosticCollectors = [
  {
    id: "elixir-otp-version-performance",
    gate: gateKeys.elixirHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectElixirOtpVersionDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
  {
    id: "prefer-elixir-parallel-deps-compile",
    gate: gateKeys.elixirHeavy,
    collect: collectElixirParallelDepsCompileDiagnostics,
  },
] satisfies readonly RepositoryDiagnosticCollector[];

export const toolDiagnosticCollectors = [
  {
    id: "prefer-mise-over-asdf",
    collect: (context: RepositoryDiagnosticContext) =>
      collectPreferMiseOverAsdfDiagnostics(context),
  },
] satisfies readonly RepositoryDiagnosticCollector[];
