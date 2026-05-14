import type {
  RepositoryDiagnosticCollector,
  RepositoryDiagnosticContext,
} from "./collector-types.ts";
import { gateKeys } from "./gates.ts";
import { collectDatadogLambdaExtensionDiagnostics } from "./datadog-lambda-extension.ts";
import { collectDockerBuildDiagnostics } from "./docker.ts";
import { collectElixirOtpVersionDiagnostics } from "./elixir-otp-versions.ts";
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
] satisfies readonly RepositoryDiagnosticCollector[];

export const toolDiagnosticCollectors = [
  {
    id: "prefer-mise-over-asdf",
    collect: (context: RepositoryDiagnosticContext) =>
      collectPreferMiseOverAsdfDiagnostics(context),
  },
] satisfies readonly RepositoryDiagnosticCollector[];
