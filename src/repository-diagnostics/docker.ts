import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { collectDockerBuildTargets } from "./docker-build-targets.ts";
import { collectDockerCacheCopyPathMismatchDiagnostics } from "./docker-cache-copy-path-mismatch.ts";
import {
  collectDockerfileCopyLinkDiagnostics,
  collectDockerfileCopyOrderDiagnostics,
  collectDockerignoreDiagnostics,
} from "./docker-build-context-diagnostics.ts";
import {
  collectDockerfileImageSizeDiagnostics,
  collectNodeDockerfileInstallDiagnostics,
} from "./docker-image-diagnostics.ts";

export async function collectDockerBuildDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const targets = await collectDockerBuildTargets(repoRoot, workflows, warnings, scanContext);
  const results = await Promise.allSettled([
    collectDockerignoreDiagnostics(repoRoot, repository, targets, warnings, scanContext),
    collectDockerfileCopyOrderDiagnostics(repoRoot, repository, targets, warnings, scanContext),
    collectDockerfileCopyLinkDiagnostics(repoRoot, repository, targets, warnings, scanContext),
    collectDockerfileImageSizeDiagnostics(repoRoot, repository, targets, warnings, scanContext),
    collectNodeDockerfileInstallDiagnostics(repoRoot, repository, targets, warnings, scanContext),
    collectDockerCacheCopyPathMismatchDiagnostics(
      repoRoot,
      repository,
      targets,
      warnings,
      scanContext,
    ),
  ]);

  const diagnostics: Diagnostic[][] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      diagnostics.push(result.value);
    }
  }

  return diagnostics.flat();
}
