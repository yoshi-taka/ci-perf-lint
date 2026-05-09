import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  collectDockerfileData,
  type DockerBuildTarget,
  normalizeRelativePath,
} from "./docker-build-targets.ts";
import { collectDockerfileStageAliases } from "./dockerfile-instructions.ts";
import {
  type NodeDockerfileLockfileKind,
  nodeDockerfileLockfileDiagnosticRules,
} from "./docker-image-rule-catalog.ts";
import { collectCargoInstallDiagnostics } from "./docker-cargo-install-diagnostics.ts";
import { collectCompiledBuildSourceLayerDiagnostics } from "./docker-compiled-build-source-layer-diagnostics.ts";
import { collectFinalStageBroadCopyDiagnostics } from "./docker-final-stage-copy-diagnostics.ts";
import { collectSingleInstructionImageSizeDiagnostics } from "./docker-image-size-single-instruction-diagnostics.ts";
import {
  collectDockerInstallContextProbes,
  dockerInstallContextHasSignals,
} from "./docker-install-context-probes.ts";
import { collectDockerInstallCacheMountDiagnostics } from "./docker-install-cache-mount-diagnostics.ts";

export async function collectDockerfileImageSizeDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  targets: DockerBuildTarget[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];
  const seenDockerfiles = new Set<string>();

  for (const target of targets) {
    if (seenDockerfiles.has(target.dockerfilePath)) {
      continue;
    }
    seenDockerfiles.add(target.dockerfilePath);

    const dockerfileData = await collectDockerfileData(context, target.dockerfilePath);
    if (!dockerfileData) {
      continue;
    }

    const dockerfileRelativePath = normalizeRelativePath(repoRoot, target.dockerfilePath);
    const { instructions, fromInstructionIndexes, finalFromInstructionIndex } = dockerfileData;

    const stageAliases = collectDockerfileStageAliases(instructions);
    diagnostics.push(
      ...collectSingleInstructionImageSizeDiagnostics(
        repository,
        target.workflow,
        dockerfileRelativePath,
        instructions,
        stageAliases,
      ),
    );

    diagnostics.push(
      ...collectFinalStageBroadCopyDiagnostics({
        repository,
        workflowPath: target.workflow,
        dockerfileRelativePath,
        instructions,
        fromInstructionIndexes,
        finalFromInstructionIndex,
      }),
    );
  }

  return diagnostics;
}

export async function collectNodeDockerfileInstallDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  targets: DockerBuildTarget[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];
  const seenDockerfiles = new Set<string>();

  for (const target of targets) {
    if (seenDockerfiles.has(target.dockerfilePath)) {
      continue;
    }
    seenDockerfiles.add(target.dockerfilePath);

    const probes = await collectDockerInstallContextProbes(context, target.contextPath);
    if (!dockerInstallContextHasSignals(probes)) {
      continue;
    }

    const dockerfileData = await collectDockerfileData(context, target.dockerfilePath);
    if (!dockerfileData) {
      continue;
    }

    const dockerfileRelativePath = normalizeRelativePath(repoRoot, target.dockerfilePath);
    const { instructions } = dockerfileData;

    diagnostics.push(
      ...collectCompiledBuildSourceLayerDiagnostics(
        repository,
        target.workflow,
        dockerfileRelativePath,
        instructions,
        probes,
      ),
    );

    const nodeLockfiles: Record<NodeDockerfileLockfileKind, boolean> = probes.nodeLockfiles;

    for (const rule of nodeDockerfileLockfileDiagnosticRules) {
      if (!nodeLockfiles[rule.lockfile]) {
        continue;
      }

      const installInstruction = instructions.find((instruction) => rule.matcher(instruction.text));
      if (!installInstruction) {
        continue;
      }

      diagnostics.push({
        ruleId: rule.ruleId,
        severity: "warning",
        confidence: "high",
        scope: "repository",
        docsPath: rule.docsPath,
        workflow: repository.primaryWorkflowPath ?? target.workflow,
        location: {
          path: dockerfileRelativePath,
          line: installInstruction.startLine,
          column: 1,
        },
        message: rule.message(dockerfileRelativePath),
        why: rule.why,
        suggestion: rule.suggestion,
        measurementHint: rule.measurementHint,
        aiHandoff: rule.aiHandoff(dockerfileRelativePath),
        score: rule.score,
      });
    }

    diagnostics.push(
      ...collectCargoInstallDiagnostics(
        repository,
        target.workflow,
        dockerfileRelativePath,
        instructions,
        probes,
      ),
    );
    diagnostics.push(
      ...collectDockerInstallCacheMountDiagnostics(
        repository,
        target.workflow,
        dockerfileRelativePath,
        instructions,
        probes,
      ),
    );
  }

  return diagnostics;
}
