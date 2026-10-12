import path from "node:path";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { parseDockerfileCopyInstruction } from "./dockerfile-instructions.ts";
import {
  collectDockerBuildStageContext,
  dockerInstructionContent,
  dockerInstructionKeyword,
  dockerStageAncestry,
  localSourceStage,
} from "./docker-build-stage-context.ts";
import { findDockerBuildRuntimeEvidence } from "./docker-build-runtime-evidence.ts";
import { findRetainedCompilerArtifacts } from "./docker-rootfs-compiler-artifacts.ts";

const nonRuntimePattern =
  /(?:^|[/._-])(?:build(?:er)?|dev|development|tests?|ci|debug|tools?|toolchain|bench(?:mark)?)(?:$|[/._-])/i;

export function findDockerRuntimeRootfsCopies(
  instructions: CollectedDockerfileInstruction[],
  targetStage?: string,
  goMainModule?: string,
) {
  const context = collectDockerBuildStageContext(instructions, targetStage);
  if (!context || (context.output.alias && nonRuntimePattern.test(context.output.alias))) {
    return [];
  }
  const outputEntries = context.ancestry.flatMap((stage) => stage.entries);
  const execution = outputEntries
    .filter(({ instruction }) => /^(?:ENTRYPOINT|CMD)$/.test(dockerInstructionKeyword(instruction)))
    .map(({ instruction }) => instruction);
  if (!execution.length) {
    return [];
  }
  const lastCommand =
    execution.findLast((instruction) => dockerInstructionKeyword(instruction) === "ENTRYPOINT") ??
    execution.at(-1)!;
  const content = dockerInstructionContent(lastCommand).trim();
  const first =
    lastCommand.jsonStrings?.[0] ??
    content
      .replace(/^exec\s+/, "")
      .split(/\s/, 1)[0]
      ?.replace(/^['"]|['"]$/g, "");
  if (!context.output.workdir && !first?.startsWith("/")) {
    return [];
  }
  const results: {
    copy: CollectedDockerfileInstruction;
    artifact: { path: string; line: number };
    source: string;
    compiler: string;
  }[] = [];
  for (const [index, entry] of outputEntries.entries()) {
    const copy = parseDockerfileCopyInstruction(entry.instruction);
    if (
      copy?.sources.length !== 1 ||
      /[$*?]/.test(copy.sources[0]!) ||
      path.posix.normalize(copy.sources[0]!) !== "/" ||
      path.posix.normalize(copy.destination) !== "/" ||
      entry.instruction.flags?.some((flag) => flag.name.toLowerCase() !== "from")
    ) {
      continue;
    }
    const source = localSourceStage(entry.instruction, context.stages);
    if (!source || source.from.startLine >= entry.instruction.startLine) {
      continue;
    }
    // FROM inheritance already has its own build/runtime separation diagnostic.
    if (context.ancestry.some((stage) => stage.index === source.index)) {
      continue;
    }
    if (
      outputEntries
        .slice(index + 1)
        .some(({ instruction }) => /^(?:RUN|COPY|ADD)$/.test(dockerInstructionKeyword(instruction)))
    ) {
      continue;
    }
    const sourceStages = dockerStageAncestry(context.stages, source);
    const retained = findRetainedCompilerArtifacts(context.stages, source, goMainModule);
    if (!retained) {
      continue;
    }
    // Match verified artifact paths against the existing execution-config parser.
    // These records represent compiler output/cp data flow, not additional builds.
    const workdir = context.output.workdir ?? "/";
    const evidence = findDockerBuildRuntimeEvidence([
      ...sourceStages.map((stage) => stage.from),
      ...retained.artifacts.map((artifact) => ({
        text: `RUN ${retained.compiler}${retained.compiler === "go" ? " build" : ""} -o ${artifact.path}`,
        keyword: "RUN",
        argumentsContent: `${retained.compiler}${retained.compiler === "go" ? " build" : ""} -o ${artifact.path}`,
        startLine: artifact.line,
      })),
      {
        text: `WORKDIR ${workdir}`,
        keyword: "WORKDIR",
        argumentsContent: workdir,
        startLine: context.output.from.startLine,
      },
      {
        text: "ENTRYPOINT []",
        keyword: "ENTRYPOINT",
        argumentsContent: "[]",
        jsonStrings: [],
        startLine: context.output.from.startLine,
      },
      ...execution,
    ]);
    if (!evidence?.compiler) {
      continue;
    }
    results.push({
      copy: entry.instruction,
      artifact: evidence.artifact,
      source: source.alias ?? String(source.index),
      compiler: evidence.compiler === "go" ? "Go" : "Rust",
    });
  }
  return results;
}
