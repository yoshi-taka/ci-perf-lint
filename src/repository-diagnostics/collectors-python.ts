import type { RepositoryDiagnosticCollector } from "./collector-types.ts";
import { gates } from "./gates.ts";
import { collectPytestDiagnostics } from "./pytest.ts";
import { collectPytestXdistInstalledButNotUsedDiagnostics } from "./pytest-xdist-installed-but-not-used.ts";
import { collectAvoidMypyProductionBundleDiagnostics } from "./avoid-mypy-production-bundle.ts";
import { collectMypyMilestoneDiagnostics } from "./mypy-milestone.ts";
import { collectPreferPydanticV2Diagnostics } from "./prefer-pydantic-v2.ts";
import { collectPyramidConfigScanDiagnostics } from "./pyramid-config-scan.ts";
import { collectPdmWithoutUseUvDiagnostics } from "./pdm-without-use-uv.ts";
import { collectPythonTopLevelHeavyClientInitDiagnostics } from "./python-top-level-heavy-client-init.ts";
import { collectNoxWithoutUvBackendDiagnostics } from "./nox-without-uv-backend.ts";
import { collectPreferRuffFormatOverBlackDiagnostics } from "./prefer-ruff-format-over-black.ts";
import { collectPreferRuffImportSortingOverIsortDiagnostics } from "./prefer-ruff-import-sorting-over-isort.ts";
import { collectToxWithoutToxUvDiagnostics } from "./tox-without-tox-uv.ts";
import { collectHatchWithoutUvInstallerDiagnostics } from "./hatch-without-uv-installer.ts";
import { collectAsyncTestUsesSyncTestClientDiagnostics } from "./async-test-uses-sync-testclient.ts";

export const pytestDiagnosticCollectors = [
  {
    id: "async-test-uses-sync-testclient",
    gate: gates.pytest,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectAsyncTestUsesSyncTestClientDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "pytest-diagnostics",
    gate: gates.pytest,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectPytestDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
  {
    id: "pytest-xdist-installed-but-not-used",
    gate: gates.pytest,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectPytestXdistInstalledButNotUsedDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
] satisfies readonly RepositoryDiagnosticCollector[];

export const pythonDiagnosticCollectors = [
  {
    id: "avoid-mypy-production-bundle",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectAvoidMypyProductionBundleDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
  {
    id: "prefer-mypy-performance-milestone",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectMypyMilestoneDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-pydantic-v2",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPreferPydanticV2Diagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-ruff-format-over-black",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPreferRuffFormatOverBlackDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-ruff-import-sorting-over-isort",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPreferRuffImportSortingOverIsortDiagnostics(
        repoRoot,
        repository,
        warnings,
        scanContext,
      ),
  },
  {
    id: "pyramid-config-scan-unrestricted",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPyramidConfigScanDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "hatch-without-uv-installer",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectHatchWithoutUvInstallerDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "nox-without-uv-backend",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectNoxWithoutUvBackendDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
  {
    id: "pdm-without-use-uv",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPdmWithoutUseUvDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "python-top-level-heavy-client-init",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPythonTopLevelHeavyClientInitDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "tox-without-tox-uv",
    gate: gates.pythonHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext, corpusIndex }) =>
      collectToxWithoutToxUvDiagnostics(repoRoot, repository, warnings, scanContext, corpusIndex),
  },
] satisfies readonly RepositoryDiagnosticCollector[];
