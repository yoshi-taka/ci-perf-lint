import type { Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { findBroadSourceCopyBeforeCompiledBuild } from "./dockerfile-instructions.ts";
import { dockerfileCompiledBuildCopiesSourceLayerDocsPath } from "./docker-image-rule-catalog.ts";
import type { DockerInstallContextProbes } from "./docker-install-context-probes.ts";

export function collectCompiledBuildSourceLayerDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
  probes: DockerInstallContextProbes,
): Diagnostic[] {
  if (!probes.hasCargoManifest && !probes.hasGoMod) {
    return [];
  }

  const compiledBuildSourceCopy = findBroadSourceCopyBeforeCompiledBuild(instructions);
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
        line: compiledBuildSourceCopy.copyInstruction.startLine,
        column: 1,
      },
      message: `Dockerfile ${dockerfileRelativePath} copies the broad build context before a ${compiledBuildSourceCopy.language} compile step at line ${compiledBuildSourceCopy.buildInstruction.startLine}.`,
      why: "For compiled Docker builds, source files are often only needed temporarily to produce a binary or artifact. Copying the whole source tree creates a source layer that changes frequently and invalidates later layers.",
      suggestion:
        "Consider using a BuildKit bind mount on the compile RUN instruction, such as `RUN --mount=type=bind,target=. ...`, and copy only the compiled artifact into the final stage.",
      measurementHint:
        "Compare Docker layer changes, image size, and rebuild time after replacing broad source COPY for the compile step with a BuildKit bind mount.",
      aiHandoff: `Review ${dockerfileRelativePath} and consider replacing the broad source \`COPY\` before the ${compiledBuildSourceCopy.language} compile step with a BuildKit bind mount on the compile \`RUN\`, then copy only the resulting artifact into the final image.`,
      score: 70,
    },
  ];
}
