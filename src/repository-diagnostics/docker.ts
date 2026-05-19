import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryFeatureIndex } from "./repository-feature-index.ts";
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
import { collectJvmProductionImageUsesJdkRuntimeDiagnostics } from "./jvm-docker-jdk-runtime.ts";

interface DockerDiagnosticsOptions {
  warnings?: AnalysisWarning[];
  scanContext?: RepositoryScanContext;
  featureIndex?: RepositoryFeatureIndex;
}

export async function collectDockerBuildDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  options: DockerDiagnosticsOptions = {},
): Promise<Diagnostic[]> {
  const { warnings, scanContext, featureIndex } = options;
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const targets = featureIndex
    ? await featureIndex.getDockerBuildTargets(repoRoot, context, warnings ?? [])
    : await collectDockerBuildTargets(repoRoot, workflows, warnings, context);
  const results = await Promise.allSettled([
    collectDockerignoreDiagnostics(repoRoot, repository, targets, warnings, scanContext),
    collectDockerfileCopyOrderDiagnostics(
      repoRoot,
      repository,
      targets,
      warnings,
      scanContext,
      featureIndex,
    ),
    collectDockerfileCopyLinkDiagnostics(
      repoRoot,
      repository,
      targets,
      warnings,
      scanContext,
      featureIndex,
    ),
    collectDockerfileImageSizeDiagnostics(
      repoRoot,
      repository,
      targets,
      warnings,
      scanContext,
      featureIndex,
    ),
    collectNodeDockerfileInstallDiagnostics(
      repoRoot,
      repository,
      targets,
      warnings,
      scanContext,
      featureIndex,
    ),
    collectDockerCacheCopyPathMismatchDiagnostics(
      repoRoot,
      repository,
      targets,
      warnings,
      scanContext,
      featureIndex,
    ),
    collectJvmProductionImageUsesJdkRuntimeDiagnostics(
      repoRoot,
      repository,
      targets,
      warnings,
      scanContext,
      featureIndex,
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
