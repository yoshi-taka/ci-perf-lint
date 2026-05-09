import type { RepositoryDiagnosticCollector } from "./collector-types.ts";
import { gates } from "./gates.ts";
import { collectDatadogLambdaExtensionDiagnostics } from "./datadog-lambda-extension.ts";
import { collectDockerBuildDiagnostics } from "./docker.ts";
import { collectElixirOtpVersionDiagnostics } from "./elixir-otp-versions.ts";
import { collectLargeFileDiagnostics } from "./large-files.ts";

export const dockerDiagnosticCollectors = [
  {
    id: "docker-build-diagnostics",
    gate: gates.dockerHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectDockerBuildDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
] satisfies readonly RepositoryDiagnosticCollector[];

export const largeFileDiagnosticCollectors = [
  {
    id: "detected-large-files",
    gate: gates.largeFiles,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectLargeFileDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
] satisfies readonly RepositoryDiagnosticCollector[];

export const datadogDiagnosticCollectors = [
  {
    id: "datadog-lambda-extension-diagnostics",
    gate: gates.datadogHeavy,
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
    gate: gates.elixirHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectElixirOtpVersionDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
] satisfies readonly RepositoryDiagnosticCollector[];
