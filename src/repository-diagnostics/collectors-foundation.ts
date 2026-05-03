import type { RepositoryDiagnosticCollector } from "./collector-types.ts";
import { collectDatadogLambdaExtensionDiagnostics } from "./datadog-lambda-extension.ts";
import { collectDockerBuildDiagnostics } from "./docker.ts";
import { collectElixirOtpVersionDiagnostics } from "./elixir-otp-versions.ts";
import { collectLargeFileDiagnostics } from "./large-files.ts";

export const dockerDiagnosticCollectors = [
  {
    id: "docker-build-diagnostics",
    gate: "docker-heavy",
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectDockerBuildDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
] satisfies readonly RepositoryDiagnosticCollector[];

export const largeFileDiagnosticCollectors = [
  {
    id: "detected-large-files",
    gate: "large-files",
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectLargeFileDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
] satisfies readonly RepositoryDiagnosticCollector[];

export const datadogDiagnosticCollectors = [
  {
    id: "datadog-lambda-extension-diagnostics",
    gate: "datadog-heavy",
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
    gate: "elixir-heavy",
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectElixirOtpVersionDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
] satisfies readonly RepositoryDiagnosticCollector[];
