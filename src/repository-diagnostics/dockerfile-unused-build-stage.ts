import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import type { RepositoryFeatureIndex } from "./repository-feature-index.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { normalizeRelativePath, type DockerBuildTarget } from "./docker-build-targets.ts";
import {
  collectDockerfileStages,
  collectReachableDockerfileInstructionIndexes,
} from "./dockerfile-instructions.ts";

const meta = {
  id: "dockerfile-unused-build-stage",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-unused-build-stage.md",
} satisfies RuleMeta;

// eslint-disable-next-line max-params
export async function collectDockerfileUnusedBuildStageDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  targets: DockerBuildTarget[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
  featureIndex?: RepositoryFeatureIndex,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const targetsByDockerfile = new Map<string, DockerBuildTarget[]>();
  for (const target of targets) {
    const existing = targetsByDockerfile.get(target.dockerfilePath) ?? [];
    existing.push(target);
    targetsByDockerfile.set(target.dockerfilePath, existing);
  }

  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const [dockerfilePath, dockerfileTargets] of targetsByDockerfile) {
    if (seen.has(dockerfilePath)) {
      continue;
    }
    seen.add(dockerfilePath);

    const data = featureIndex
      ? await featureIndex.getDockerfileData(dockerfilePath, context)
      : undefined;
    if (!data) {
      continue;
    }
    const stages = collectDockerfileStages(data.instructions);
    if (!stages) {
      continue;
    }

    const reachableStages = new Set<number>();
    let resolvedEveryTarget = true;
    for (const target of dockerfileTargets) {
      const reachable = collectReachableDockerfileInstructionIndexes(
        data.instructions,
        target.targetStage,
      );
      if (!reachable) {
        resolvedEveryTarget = false;
        break;
      }
      for (const stage of stages) {
        if (reachable.has(stage.fromInstructionIndex)) {
          reachableStages.add(stage.index);
        }
      }
    }
    if (!resolvedEveryTarget) {
      continue;
    }

    const relativePath = normalizeRelativePath(repoRoot, dockerfilePath);
    for (const stage of stages) {
      if (reachableStages.has(stage.index)) {
        continue;
      }
      const instruction = data.instructions[stage.fromInstructionIndex];
      if (!instruction) {
        continue;
      }
      const label = stage.alias
        ? `stage "${stage.alias}"`
        : `stage ${stage.index + 1} (${instruction.text.trim()})`;
      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: {
            path: relativePath,
            line: instruction.startLine,
            column: 1,
          },
          message: `Dockerfile ${label} is not referenced by any reachable stage or build target.`,
          why: "BuildKit skips stages that no reachable stage or requested target references. Instructions in an unused stage therefore do not affect the image, and stale cache priming or invalid COPY paths there can stay hidden indefinitely.",
          suggestion:
            "Remove the unused stage, or reference it with `COPY --from=<stage>` or `FROM <stage>` if its output is intended to be used. If CI builds it explicitly with `--target`, keep that target in the build targets.",
          measurementHint:
            "After removing or wiring the stage, confirm the image build and cache hit behavior are unchanged.",
          aiHandoff: `Review ${relativePath}:${instruction.startLine}. The Dockerfile stage ${
            stage.alias ?? `#${stage.index + 1}`
          } is not reachable from the final image or any CI build target. Remove it, or add a COPY/FROM reference if the stage is intended to run.`,
          score: 35,
        }),
      );
    }
  }

  return diagnostics;
}
