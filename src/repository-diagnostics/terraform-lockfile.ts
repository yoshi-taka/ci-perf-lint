import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { collectTerraformCommands } from "./terraform-commands.ts";
import { getLocation } from "../workflow.ts";

const meta = {
  id: "terraform-lockfile-missing",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/terraform-lockfile-missing.md",
} satisfies RuleMeta;

export async function collectTerraformLockfileDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const findings: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const command of collectTerraformCommands(context.workflows)) {
    if (command.verb !== "init" || seen.has(command.directory)) {
      continue;
    }
    seen.add(command.directory);
    const lockfile = path.posix.join(command.directory, ".terraform.lock.hcl");
    if (await context.scanContext.pathExists(context.scanContext.resolve(lockfile))) {
      continue;
    }
    findings.push(
      buildRepositoryDiagnostic(context.repository, meta, {
        location: getLocation(command.workflow, command.step.runNode ?? command.step.node),
        message: `No ${lockfile} found for Terraform root module "${command.directory}" initialized by this workflow.`,
        why: "The dependency lock file pins provider versions and enables deterministic provider caching. Without it, Terraform may use different provider versions across environments, and the provider cache key has nothing stable to hash against.",
        suggestion:
          "Run 'terraform init' locally or via CI to generate .terraform.lock.hcl, commit it, then add CI platform hashes: 'terraform providers lock -platform=linux_amd64 -platform=linux_arm64'. Commit the updated lock file.",
        measurementHint:
          "After committing the lock file, verify that provider versions are consistent between local and CI runs.",
        aiHandoff: `Commit ${lockfile} for Terraform root module "${command.directory}" and ensure it includes CI platform hashes via 'terraform providers lock'. Update ${command.workflow.relativePath} to key caching on the applicable lockfile.`,
        score: 70,
      }),
    );
  }
  return findings;
}
