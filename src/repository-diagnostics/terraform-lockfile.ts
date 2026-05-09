import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryFeatureIndex } from "./repository-feature-index.ts";

const meta = {
  id: "terraform-lockfile-missing",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/terraform-lockfile-missing.md",
} satisfies RuleMeta;

export async function collectTerraformLockfileDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
  featureIndex?: RepositoryFeatureIndex,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  const lockFiles: string[] = [];
  for await (const relativePath of context.walkFilesIter(".", {
    ignoredDirectories: new Set([".git", "node_modules"]),
    include: (candidatePath) => candidatePath.endsWith(".terraform.lock.hcl"),
  })) {
    lockFiles.push(relativePath);
  }

  if (lockFiles.length > 0) {
    return [];
  }

  const terraformWorkflows = featureIndex?.workflowsWithEcosystem("terraform") ?? [];
  const primaryWorkflow =
    terraformWorkflows.find((w) => w.relativePath === repository.primaryWorkflowPath) ??
    terraformWorkflows[0];

  if (!primaryWorkflow) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: primaryWorkflow.relativePath,
        line: 1,
        column: 1,
      },
      message:
        "No .terraform.lock.hcl found in the repository, but terraform init is used in workflows.",
      why: "The dependency lock file pins provider versions and enables deterministic provider caching. Without it, Terraform may use different provider versions across environments, and the provider cache key has nothing stable to hash against.",
      suggestion:
        "Run 'terraform init' locally or via CI to generate .terraform.lock.hcl, commit it, then add CI platform hashes: 'terraform providers lock -platform=linux_amd64 -platform=linux_arm64'. Commit the updated lock file.",
      measurementHint:
        "After committing the lock file, verify that provider versions are consistent between local and CI runs.",
      aiHandoff: `Commit .terraform.lock.hcl and ensure it includes CI platform hashes (linux_amd64, linux_arm64) via 'terraform providers lock'. Then update ${primaryWorkflow.relativePath} to use provider caching keyed on hashFiles('**/.terraform.lock.hcl').`,
      score: 70,
    }),
  ];
}
