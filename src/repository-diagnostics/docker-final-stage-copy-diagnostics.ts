import type { Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import {
  dockerfileSourceLooksWholeContext,
  parseDockerfileCopyInstruction,
} from "./dockerfile-instructions.ts";
import { dockerfileFinalStageCopiesBroadContextDocsPath } from "./docker-image-rule-catalog.ts";

interface CollectFinalStageBroadCopyOptions {
  repository: RepositorySignals;
  workflowPath: string;
  dockerfileRelativePath: string;
  instructions: CollectedDockerfileInstruction[];
  fromInstructionIndexes: number[];
  finalFromInstructionIndex: number;
}

export function collectFinalStageBroadCopyDiagnostics(
  options: CollectFinalStageBroadCopyOptions,
): Diagnostic[] {
  for (let index = 0; index < options.instructions.length; index += 1) {
    const instruction = options.instructions[index];
    if (!instruction) {
      continue;
    }

    const copyInstruction = parseDockerfileCopyInstruction(instruction);
    if (!copyInstruction) {
      continue;
    }

    const currentStageStart = options.fromInstructionIndexes
      .filter((fromIndex) => fromIndex <= index)
      .at(-1);
    const inFinalStage = currentStageStart === options.finalFromInstructionIndex;
    const copiesFromStage = (instruction.flags ?? []).some(
      (flag) => flag.name.toLowerCase() === "from",
    );
    if (
      !inFinalStage ||
      copiesFromStage ||
      !copyInstruction.sources.some((source) => dockerfileSourceLooksWholeContext(source))
    ) {
      continue;
    }

    return [
      {
        ruleId: "dockerfile-final-stage-copies-broad-context",
        severity: "warning",
        confidence: "medium",
        scope: "repository",
        docsPath: dockerfileFinalStageCopiesBroadContextDocsPath,
        workflow: options.repository.primaryWorkflowPath ?? options.workflowPath,
        location: {
          path: options.dockerfileRelativePath,
          line: instruction.startLine,
          column: 1,
        },
        message: `Dockerfile ${options.dockerfileRelativePath} copies the broad build context in the final image stage.`,
        why: "A final-stage `COPY . .` can carry source files, generated output, dependency directories, local metadata, and other build-only files into the runtime image. That increases image size and can make final image layers change more often.",
        suggestion:
          "Use a multi-stage build and copy only the runtime artifacts needed by the final image, such as built output and production dependencies, preferably with `COPY --from=<builder>`.",
        measurementHint:
          "Compare final image size and final-stage layer changes before and after replacing broad final-stage COPY with targeted artifact copies.",
        aiHandoff: `Review ${options.dockerfileRelativePath} and replace final-stage \`COPY . .\` with targeted runtime artifact copies, ideally from a builder stage via \`COPY --from=<builder>\`.`,
        score: 74,
      },
    ];
  }

  return [];
}
