import path from "node:path";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import {
  directCommand,
  dockerRunCommands,
  removesDirectory,
} from "./docker-image-metadata-helpers.ts";

// Evidence only: never suppress an existing finding or cross a stage/context boundary.
export function describeLaterCacheCleanup(
  instructions: CollectedDockerfileInstruction[],
  origin: CollectedDockerfileInstruction,
  caches: readonly string[],
  nativeCleanup?: (commands: string[][], cache: string) => boolean,
): string {
  const pending = new Set(
    caches
      .filter((cache) => cache.startsWith("/") && !/[$`*?]/.test(cache))
      .map((cache) => path.posix.normalize(cache)),
  );
  if (!pending.size) {
    return "";
  }
  const evidence: string[] = [];
  for (let index = instructions.indexOf(origin) + 1; index < instructions.length; index++) {
    const instruction = instructions[index]!;
    const keyword =
      instruction.keyword?.toUpperCase() ??
      instruction.text.trim().split(/\s+/, 1)[0]?.toUpperCase();
    if (/^(?:FROM|ENV|ARG|USER|WORKDIR|SHELL)$/.test(keyword ?? "")) {
      break;
    }
    const commands = dockerRunCommands(instruction);
    if (
      commands.some((tokens) => {
        const { name, args } = directCommand(tokens);
        return (
          /^(?:export|unset|cd)$/.test(name) ||
          (args[0] === "config" && /^(?:set|delete|unset)$/.test(args[1] ?? ""))
        );
      })
    ) {
      break;
    }
    // A cleanup inside a mount does not prove deletion from the stage rootfs.
    if (instruction.flags?.some((flag) => flag.name === "mount")) {
      continue;
    }
    for (const cache of pending) {
      if (
        commands.some((tokens) => removesDirectory(tokens, cache, instruction.text)) ||
        nativeCleanup?.(commands, cache)
      ) {
        evidence.push(
          `RUN line ${origin.startLine} -> RUN line ${instruction.startLine} (${cache})`,
        );
        pending.delete(cache);
      }
    }
    if (!pending.size) {
      break;
    }
  }
  return evidence.length
    ? ` Later cleanup cannot reclaim earlier-layer bytes: ${evidence.join("; ")}.`
    : "";
}
