import type { Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { findSourceBindCandidate } from "./docker-source-bind-evidence.ts";
import { dockerfileCompiledBuildCopiesSourceLayerDocsPath } from "./docker-image-rule-catalog.ts";
import type { DockerInstallContextProbes } from "./docker-install-context-probes.ts";

export function collectCompiledBuildSourceLayerDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
  probes: DockerInstallContextProbes,
): Diagnostic[] {
  if (
    !probes.hasCargoManifest &&
    !probes.hasGoMod &&
    !probes.hasMavenPom &&
    !probes.hasGradleBuild
  ) {
    return [];
  }

  const compiledBuildSourceCopy = findSourceBindCandidate(instructions, probes);
  if (!compiledBuildSourceCopy) {
    return [];
  }

  return [
    {
      ruleId: "dockerfile-compiled-build-copies-source-layer",
      severity: "warning",
      confidence: "medium",
      scope: "repository",
      docsPath: dockerfileCompiledBuildCopiesSourceLayerDocsPath,
      workflow: repository.primaryWorkflowPath ?? workflowPath,
      location: {
        path: dockerfileRelativePath,
        line: compiledBuildSourceCopy.copy.instruction.startLine,
        column: 1,
      },
      message: `Dockerfile ${dockerfileRelativePath} copies ${compiledBuildSourceCopy.source} into ${compiledBuildSourceCopy.destination} before a ${compiledBuildSourceCopy.compilation.language} build at line ${compiledBuildSourceCopy.build.instruction.startLine}, while later stages copy only its artifacts.`,
      why: "Temporary build inputs do not need their own persisted source layer. A bind mount can reduce intermediate snapshot and cache export costs. Source changes still invalidate the build RUN, and a binary-only final image may be unchanged.",
      suggestion:
        "Consider replacing the source COPY with a read-only BuildKit bind mount on the build RUN. Keep all outputs outside that mount and preserve build manifests, wrappers, generated assets, and artifact copies. For Maven/Gradle, mount only the source subtree rather than the whole project.",
      measurementHint:
        "Compare intermediate build-cache size, export bytes and duration, and cold/warm rebuild time. Verify read-only source compatibility, generated/embedded assets, and artifact equivalence; do not assume fewer invalidations or a smaller final image.",
      aiHandoff: `Review ${dockerfileRelativePath}, COPY at line ${compiledBuildSourceCopy.copy.instruction.startLine} and build at line ${compiledBuildSourceCopy.build.instruction.startLine}. Consider --mount=type=bind,source=${compiledBuildSourceCopy.source},target=${compiledBuildSourceCopy.destination}. Keep outputs outside the mount, preserve metadata/ownership and generated inputs, and test that compilation and Java build plugins do not write into the source subtree. Preserve existing final-stage artifact copies.`,
      score: 55,
    },
  ];
}
