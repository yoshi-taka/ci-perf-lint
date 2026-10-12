import type {
  collectDockerBuildStageContext,
  DockerBuildStage,
} from "./docker-build-stage-context.ts";
import { dockerInstructionKeyword, localSourceStage } from "./docker-build-stage-context.ts";
import { parseDockerfileCopyInstruction } from "./dockerfile-instructions.ts";
import { pathWithinSourceBind, resolveSourceBindPath } from "./docker-source-bind-commands.ts";

export function archiveHasOnlyArtifactExports(
  stage: DockerBuildStage,
  afterIndex: number,
  archive: string,
  directory: string,
  context: NonNullable<ReturnType<typeof collectDockerBuildStageContext>>,
): boolean {
  if (context.ancestry.some((ancestor) => ancestor.index === stage.index)) {
    return false;
  }
  if (
    stage.entries
      .slice(afterIndex + 1)
      .some(
        ({ instruction }) =>
          !/^(?:WORKDIR|ENV|USER|LABEL|CMD|ENTRYPOINT)$/.test(
            dockerInstructionKeyword(instruction),
          ),
      )
  ) {
    return false;
  }
  let exports = 0;
  for (const other of context.stages) {
    if (other.parent === stage.index) {
      return false;
    }
    for (const { instruction } of other.entries) {
      for (const flag of instruction.flags ?? []) {
        if (flag.name.toLowerCase() === "from" && /[$`]/.test(flag.value ?? "")) {
          return false;
        }
        if (flag.name.toLowerCase() === "mount") {
          const from = (flag.value ?? "")
            .split(",")
            .find((part) => part.startsWith("from="))
            ?.slice(5);
          if (
            from &&
            (from.toLowerCase() === stage.alias ||
              from === String(stage.index) ||
              /[$`]/.test(from))
          ) {
            return false;
          }
        }
      }
      if (localSourceStage(instruction, context.stages)?.index !== stage.index) {
        continue;
      }
      const copy = parseDockerfileCopyInstruction(instruction);
      if (
        !copy ||
        !copy.sources.every((value) => {
          const file = resolveSourceBindPath(value, "/");
          return (
            !!file && pathWithinSourceBind(file, directory) && !pathWithinSourceBind(archive, file)
          );
        })
      ) {
        return false;
      }
      exports++;
    }
  }
  return exports > 0;
}
