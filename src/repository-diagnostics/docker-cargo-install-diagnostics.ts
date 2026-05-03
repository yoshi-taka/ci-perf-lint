import type { Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { instructionLooksCargoInstallWithoutLocked } from "./dockerfile-instructions.ts";
import { dockerfileCargoInstallWithoutLockedDocsPath } from "./docker-image-rule-catalog.ts";
import type { DockerInstallContextProbes } from "./docker-install-context-probes.ts";

export function collectCargoInstallDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
  probes: DockerInstallContextProbes,
): Diagnostic[] {
  if (!probes.hasCargoManifest) {
    return [];
  }

  const cargoInstallInstruction = instructions.find((instruction) =>
    instructionLooksCargoInstallWithoutLocked(instruction.text),
  );

  if (!cargoInstallInstruction) {
    return [];
  }

  return [
    {
      ruleId: "dockerfile-cargo-install-without-locked",
      severity: "warning",
      confidence: "high",
      scope: "repository",
      docsPath: dockerfileCargoInstallWithoutLockedDocsPath,
      workflow: repository.primaryWorkflowPath ?? workflowPath,
      location: {
        path: dockerfileRelativePath,
        line: cargoInstallInstruction.startLine,
        column: 1,
      },
      message: `Dockerfile ${dockerfileRelativePath} runs \`cargo install\` without \`--locked\` in a Rust build context.`,
      why: "`cargo install --locked` keeps installed Rust build tools tied to their checked-in lockfiles. Without it, Docker builds can resolve a different dependency graph for tools such as cargo-chef or sccache.",
      suggestion:
        "Add `--locked` to Dockerfile `cargo install` commands that install registry or Git-hosted Rust tools. Keep `cargo install --path .` separate when installing the local project.",
      measurementHint:
        "Compare Docker build reproducibility and tool installation duration before and after adding --locked to cargo install.",
      aiHandoff: `Review ${dockerfileRelativePath} and add \`--locked\` to Docker build \`cargo install\` commands that install external Rust tools.`,
      score: 82,
    },
  ];
}
