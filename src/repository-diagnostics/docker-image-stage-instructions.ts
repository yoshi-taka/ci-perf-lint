import path from "node:path";
import {
  parseDockerfileCopyInstruction,
  parseDockerfileFromInstruction,
  type CollectedDockerfileInstruction,
} from "./dockerfile-instructions.ts";

interface Stage {
  parent?: number;
  instructions: CollectedDockerfileInstruction[];
  copies: { from: number; sources: string[] }[];
}

// Follow rootfs inheritance, plus copies of the paths relevant to the diagnostic.
// Artifact-only COPY does not carry the builder's package metadata or account logs.
export function collectImageStageInstructions(
  instructions: CollectedDockerfileInstruction[],
  targetStage: string | undefined,
  affectedPaths: readonly string[],
): CollectedDockerfileInstruction[] {
  const stages: Stage[] = [];
  const aliases = new Map<string, number>();
  for (const instruction of instructions) {
    const from = parseDockerfileFromInstruction(instruction);
    if (from) {
      if (from.image.includes("$")) {
        return [];
      }
      const parent = aliases.get(from.image.toLowerCase());
      stages.push({ parent, instructions: [instruction], copies: [] });
      const alias = /\sAS\s+(\S+)\s*$/i.exec(instruction.text)?.[1]?.toLowerCase();
      if (alias) {
        if (aliases.has(alias)) {
          return [];
        }
        aliases.set(alias, stages.length - 1);
      }
      continue;
    }
    const stage = stages.at(-1);
    if (!stage) {
      continue;
    }
    stage.instructions.push(instruction);
    const copy = parseDockerfileCopyInstruction(instruction);
    const sourceStage = instruction.flags?.find((flag) => flag.name === "from")?.value;
    if (copy && sourceStage) {
      const index =
        aliases.get(sourceStage.toLowerCase()) ??
        (/^\d+$/.test(sourceStage) ? Number(sourceStage) : undefined);
      if (index !== undefined && index < stages.length - 1) {
        stage.copies.push({ from: index, sources: copy.sources });
      }
    }
  }
  const output =
    targetStage === undefined || targetStage === ""
      ? stages.length - 1
      : aliases.get(targetStage.toLowerCase());
  if (output === undefined || output < 0) {
    return [];
  }
  const included = new Set<number>();
  const visit = (index: number) => {
    if (included.has(index)) {
      return;
    }
    included.add(index);
    const stage = stages[index]!;
    if (stage.parent !== undefined) {
      visit(stage.parent);
    }
    for (const copy of stage.copies) {
      if (
        copy.sources.some((source) => {
          if (/[$*?]/.test(source)) {
            return false;
          }
          const directory = path.posix.resolve("/", source).replace(/\/$/, "");
          return affectedPaths.some(
            (affected) => affected === directory || affected.startsWith(`${directory}/`),
          );
        })
      ) {
        visit(copy.from);
      }
    }
  };
  visit(output);
  return stages.flatMap((stage, index) => (included.has(index) ? stage.instructions : []));
}
