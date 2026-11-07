import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { collectTerraformCommands } from "./terraform-commands.ts";
import { getLocation } from "../workflow.ts";
import { shellCommandSegments, staticShellWords } from "../rules/shared/command-patterns.ts";

const meta = {
  id: "terraform-lockfile-missing",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/terraform-lockfile-missing.md",
} satisfies RuleMeta;

function removesTerraformLockfile(command: {
  job: { steps: readonly { run?: string }[] };
  step: { run?: string };
}): boolean {
  const index = command.job.steps.indexOf(command.step);
  for (const step of command.job.steps.slice(Math.max(0, index))) {
    for (const segment of shellCommandSegments(step.run ?? "")) {
      const words = staticShellWords(segment);
      if (words?.[0] !== "rm") {
        continue;
      }
      const targets = words.slice(1).filter((word) => !word.startsWith("-"));
      if (
        targets.some(
          (target) =>
            target === ".terraform.lock.hcl" ||
            target.endsWith("/.terraform.lock.hcl") ||
            target === ".terraform" ||
            target.endsWith("/.terraform"),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

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
    if (removesTerraformLockfile(command)) {
      continue;
    }
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
