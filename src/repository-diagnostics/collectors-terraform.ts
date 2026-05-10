import type { RepositoryDiagnosticCollector } from "./collector-types.ts";
import { gateKeys } from "./gates.ts";
import { collectTerraformGitHubAppAuthDiagnostics } from "./terraform-github-app-auth.ts";
import { collectTerraformGitHubParallelRequestsDiagnostics } from "./terraform-github-parallel-requests.ts";
import { collectTerraformLockfileDiagnostics } from "./terraform-lockfile.ts";
import { collectTerraformParallelismDiagnostics } from "./terraform-parallelism.ts";
import { collectTerraformGitHubSlowResourcesDiagnostics } from "./terraform-github-slow-resources.ts";
import { collectTerraformPagerDutyTeamMembershipVersionDiagnostics } from "./terraform-pagerduty-team-membership-version.ts";

export const terraformDiagnosticCollectors = [
  {
    id: "terraform-github-app-auth",
    gate: gateKeys.terraformHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectTerraformGitHubAppAuthDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
  {
    id: "terraform-github-parallel-requests",
    gate: gateKeys.terraformHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectTerraformGitHubParallelRequestsDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
  {
    id: "terraform-lockfile-missing",
    gate: gateKeys.terraformHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext, featureIndex }) =>
      collectTerraformLockfileDiagnostics(
        repoRoot,
        repository,
        warnings,
        scanContext,
        featureIndex,
      ),
  },
  {
    id: "terraform-parallelism-unconfigured",
    gate: gateKeys.terraformHeavy,
    collect: (context) => collectTerraformParallelismDiagnostics(context),
  },
  {
    id: "terraform-github-slow-resources",
    gate: gateKeys.terraformHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectTerraformGitHubSlowResourcesDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
  {
    id: "terraform-pagerduty-team-membership-version",
    gate: gateKeys.terraformHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectTerraformPagerDutyTeamMembershipVersionDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
] satisfies readonly RepositoryDiagnosticCollector[];
