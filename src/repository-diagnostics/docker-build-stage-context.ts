import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { parseDockerfileFromInstruction } from "./dockerfile-instructions.ts";
import {
  dockerBaseDefaults,
  resolveDockerStagePath,
  updateDockerDirectories,
  updateDockerEnvironment,
} from "./docker-stage-paths.ts";

export interface DockerStageEntry {
  instruction: CollectedDockerfileInstruction;
  workdir?: string;
  environment: ReadonlyMap<string, string>;
  directories: ReadonlySet<string>;
}
export interface DockerBuildStage {
  index: number;
  alias?: string;
  parent?: number;
  from: CollectedDockerfileInstruction;
  entries: DockerStageEntry[];
  dependencies: Set<number>;
  workdir?: string;
  environment: Map<string, string>;
  directories: Set<string>;
  compiler?: "go" | "rustc";
}

export function dockerInstructionKeyword(instruction: CollectedDockerfileInstruction): string {
  return (
    instruction.keyword?.toUpperCase() ??
    instruction.text.trim().split(/\s/, 1)[0]?.toUpperCase() ??
    ""
  );
}

export function dockerInstructionContent(instruction: CollectedDockerfileInstruction): string {
  return instruction.argumentsContent ?? instruction.text.replace(/^\s*\S+\s+/, "");
}

export function localSourceStage(
  instruction: CollectedDockerfileInstruction,
  stages: readonly DockerBuildStage[],
): DockerBuildStage | undefined {
  const from = instruction.flags?.find((flag) => flag.name.toLowerCase() === "from")?.value;
  return from
    ? stages.find((stage) => stage.alias === from.toLowerCase() || String(stage.index) === from)
    : undefined;
}

export function dockerStageAncestry(
  stages: readonly DockerBuildStage[],
  output: DockerBuildStage,
): DockerBuildStage[] {
  const parent = output.parent === undefined ? undefined : stages[output.parent];
  return [...(parent ? dockerStageAncestry(stages, parent) : []), output];
}

export function collectDockerBuildStageContext(
  instructions: CollectedDockerfileInstruction[],
  targetStage?: string,
) {
  const stages: DockerBuildStage[] = [];
  const aliases = new Map<string, number>();
  for (const instruction of instructions) {
    const keyword = dockerInstructionKeyword(instruction);
    if (keyword === "FROM") {
      if (
        instruction.flags?.some(
          (flag) =>
            flag.name.toLowerCase() === "platform" && /^windows(?:\/|$)/i.test(flag.value ?? ""),
        )
      ) {
        return undefined;
      }
      const from = parseDockerfileFromInstruction(instruction);
      if (!from || /[$`]/.test(from.image)) {
        return undefined;
      }
      const parent = aliases.get(from.image.toLowerCase());
      const alias = /\bAS\s+(\S+)\s*$/i
        .exec(dockerInstructionContent(instruction))?.[1]
        ?.toLowerCase();
      if (alias && aliases.has(alias)) {
        return undefined;
      }
      const defaults = dockerBaseDefaults(from.image);
      const inherited = parent === undefined ? undefined : stages[parent];
      const stage: DockerBuildStage = {
        index: stages.length,
        alias,
        parent,
        from: instruction,
        entries: [],
        dependencies: new Set(parent === undefined ? [] : [parent]),
        workdir: inherited?.workdir ?? defaults.workdir,
        environment: new Map(inherited?.environment ?? defaults.environment),
        directories: new Set(inherited?.directories ?? defaults.directories),
        compiler: inherited?.compiler ?? defaults.compiler,
      };
      stages.push(stage);
      if (alias) {
        aliases.set(alias, stage.index);
      }
      continue;
    }
    const stage = stages.at(-1);
    if (!stage) {
      continue;
    }
    if (keyword === "WORKDIR") {
      stage.workdir = resolveDockerStagePath(
        dockerInstructionContent(instruction).trim(),
        stage.workdir,
        stage.environment,
      );
      if (stage.workdir) {
        stage.directories.add(stage.workdir);
      }
    }
    if (keyword === "ENV") {
      updateDockerEnvironment(dockerInstructionContent(instruction), stage.environment);
    }
    stage.entries.push({
      instruction,
      workdir: stage.workdir,
      environment: new Map(stage.environment),
      directories: new Set(stage.directories),
    });
    if (keyword === "RUN") {
      updateDockerDirectories(instruction, stage.workdir, stage.environment, stage.directories);
    }
    const sources = (instruction.flags ?? []).flatMap((flag) => {
      if (flag.name.toLowerCase() === "from") {
        return [flag.value ?? ""];
      }
      if (flag.name.toLowerCase() === "mount") {
        return (flag.value ?? "")
          .split(",")
          .filter((option) => option.startsWith("from="))
          .map((option) => option.slice(5));
      }
      return [];
    });
    for (const source of sources) {
      const index =
        aliases.get(source.toLowerCase()) ?? (/^\d+$/.test(source) ? Number(source) : undefined);
      if (index !== undefined && index < stage.index) {
        stage.dependencies.add(index);
      }
    }
  }
  const index =
    targetStage === undefined || targetStage === ""
      ? stages.length - 1
      : aliases.get(targetStage.toLowerCase());
  const output = index === undefined ? undefined : stages[index];
  if (!output) {
    return undefined;
  }
  const reachable = new Set<number>();
  const visit = (stage: DockerBuildStage) => {
    if (reachable.has(stage.index)) {
      return;
    }
    reachable.add(stage.index);
    for (const dependency of stage.dependencies) {
      visit(stages[dependency]!);
    }
  };
  visit(output);
  const ancestry = dockerStageAncestry(stages, output);
  return { stages, output, reachable, ancestry };
}
