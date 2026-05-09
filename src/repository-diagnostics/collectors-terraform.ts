import type { RepositoryDiagnosticCollector } from "./collector-types.ts";
import { gates } from "./gates.ts";
import { collectTerraformGitHubAppAuthDiagnostics } from "./terraform-github-app-auth.ts";
import { collectTerraformGitHubParallelRequestsDiagnostics } from "./terraform-github-parallel-requests.ts";
import { collectTerraformLockfileDiagnostics } from "./terraform-lockfile.ts";
import { collectTerraformParallelismDiagnostics } from "./terraform-parallelism.ts";
import { collectTerraformGitHubSlowResourcesDiagnostics } from "./terraform-github-slow-resources.ts";
import { collectTerraformPagerDutyTeamMembershipVersionDiagnostics } from "./terraform-pagerduty-team-membership-version.ts";

export const terraformDiagnosticCollectors = [
  {
    id: "terraform-github-app-auth",
    gate: gates.terraformHeavy,
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
    gate: gates.terraformHeavy,
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
    gate: gates.terraformHeavy,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectTerraformLockfileDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
  {
    id: "terraform-parallelism-unconfigured",
    gate: gates.terraformHeavy,
    collect: (context) => collectTerraformParallelismDiagnostics(context),
  },
  {
    id: "terraform-github-slow-resources",
    gate: gates.terraformHeavy,
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
    gate: gates.terraformHeavy,
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
