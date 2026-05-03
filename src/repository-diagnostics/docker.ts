import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
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
  const results = await Promise.allSettled([
    collectDockerignoreDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
    collectDockerfileCopyOrderDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
    collectDockerfileCopyLinkDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
    collectDockerfileImageSizeDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
    collectNodeDockerfileInstallDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  ]);

  const diagnostics: Diagnostic[][] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      diagnostics.push(result.value);
    }
  }

  return diagnostics.flat();
}
