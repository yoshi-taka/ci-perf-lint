import path from "node:path";
import { parseDockerfileCopyInstruction } from "./dockerfile-instructions.ts";
import {
  type DockerBuildStage,
  type DockerStageEntry,
  dockerInstructionKeyword,
  type collectDockerBuildStageContext,
} from "./docker-build-stage-context.ts";
import { directCommand } from "./docker-image-metadata-helpers.ts";
import { pathWithinSourceBind } from "./docker-source-bind-commands.ts";
import { resolveDockerStagePath } from "./docker-stage-paths.ts";
import { archiveRunCommands, archiveOutputVerification } from "./docker-archive-commands.ts";
import { archiveHasOnlyArtifactExports } from "./docker-archive-consumers.ts";

const archivePattern = /\.(?:tar(?:\.(?:gz|bz2|xz|zst))?|tgz|tbz2?|txz|zip)$/i;

function extraction(tokens: string[], entry: DockerStageEntry) {
  const { name, args } = directCommand(tokens);
  let file: string | undefined;
  let directory = entry.workdir;
  let extract = false;
  if (name === "tar") {
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === "--extract" || arg === "--get") {
        extract = true;
      } else if (arg === "-f" || arg === "--file") {
        file = args[++index];
      } else if (arg.startsWith("--file=")) {
        file = arg.slice(7);
      } else if (arg.startsWith("-f") && arg.length > 2) {
        file = arg.slice(2);
      } else if (arg === "-C" || arg === "--directory") {
        directory = resolveDockerStagePath(args[++index] ?? "", directory, entry.environment);
      } else if (arg.startsWith("--directory=")) {
        directory = resolveDockerStagePath(arg.slice(12), directory, entry.environment);
      } else if (arg.startsWith("-C") && arg.length > 2) {
        directory = resolveDockerStagePath(arg.slice(2), directory, entry.environment);
      } else if (/^-?[xzjJavpf]+$/.test(arg)) {
        extract ||= arg.includes("x");
        if (arg.includes("f")) {
          if (!arg.endsWith("f")) {
            return undefined;
          }
          file = args[++index];
        }
      } else if (arg === "--strip-components") {
        if (!/^\d+$/.test(args[++index] ?? "")) {
          return undefined;
        }
      } else if (
        /^--strip-components=\d+$/.test(arg) ||
        /^(?:--gzip|--bzip2|--xz|--zstd|--auto-compress|--verbose|--preserve-permissions)$/.test(
          arg,
        )
      ) {
        continue;
      } else {
        return undefined;
      }
    }
  } else if (name === "unzip") {
    extract = true;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === "-d") {
        directory = resolveDockerStagePath(args[++index] ?? "", entry.workdir, entry.environment);
      } else if (/^-[oq]+$/.test(arg)) {
        continue;
      } else if (!arg.startsWith("-") && file === undefined) {
        file = arg;
      } else {
        return undefined;
      }
    }
  }
  const archive = file ? resolveDockerStagePath(file, entry.workdir, entry.environment) : undefined;
  return extract && archive && directory ? { archive, directory } : undefined;
}

function removesArchive(tokens: string[], archive: string, entry: DockerStageEntry): boolean {
  const { name, args } = directCommand(tokens);
  if (name !== "rm") {
    return false;
  }
  const files = args.filter(
    (arg) => !/^-[rfv]+$/.test(arg) && !/^(?:--force|--recursive|--verbose|--)$/.test(arg),
  );
  return (
    files.length === 1 &&
    resolveDockerStagePath(files[0]!, entry.workdir, entry.environment) === archive
  );
}

function extractionRun(entry: DockerStageEntry, archive: string) {
  const commands = archiveRunCommands(entry);
  let extracted: { archive: string; directory: string } | undefined;
  let cleaned = false;
  let verified = false;
  const directories: string[] = [];
  for (const tokens of commands) {
    const extract = extraction(tokens, entry);
    if (extract) {
      if (extracted || extract.archive !== archive || extract.directory === "/") {
        return undefined;
      }
      extracted = extract;
    } else if (
      extracted &&
      !cleaned &&
      archiveOutputVerification(tokens, extracted.directory, entry)
    ) {
      verified = true;
    } else if (extracted && removesArchive(tokens, archive, entry)) {
      cleaned = true;
    } else {
      const command = directCommand(tokens);
      if (
        command.name === "set" &&
        !extracted &&
        command.args.every((arg) => /^-[eux]+$/.test(arg))
      ) {
        continue;
      }
      const args = command.args.filter((arg) => arg !== "-p" && arg !== "--parents");
      if (extracted || command.name !== "mkdir" || args.length !== 1 || args[0]?.startsWith("-")) {
        return undefined;
      }
      const directory = resolveDockerStagePath(args[0]!, entry.workdir, entry.environment);
      if (!directory) {
        return undefined;
      }
      directories.push(directory);
    }
  }
  if (
    !extracted ||
    directories.some((directory) => !pathWithinSourceBind(extracted.directory, directory))
  ) {
    return undefined;
  }
  // Relocating the input is safe to suggest for pure extraction only. Keep the
  // original file path available to verification programs with hidden readers.
  if (verified && pathWithinSourceBind(archive, extracted.directory)) {
    return undefined;
  }
  return { ...extracted, cleaned };
}

export function findCopiedArchiveExtractions(
  stage: DockerBuildStage,
  context?: NonNullable<ReturnType<typeof collectDockerBuildStageContext>>,
) {
  const results: {
    source: string;
    archive: string;
    directory: string;
    copyLine: number;
    extractLine: number;
    cleanupLine?: number;
    mountTarget: string;
  }[] = [];
  for (const [index, entry] of stage.entries.entries()) {
    const copy = parseDockerfileCopyInstruction(entry.instruction);
    if (copy?.sources.length !== 1 || entry.instruction.flags?.length) {
      continue;
    }
    const source = copy.sources[0]!.replace(/^\.\//, "").replace(/^\/+/, "");
    if (
      !archivePattern.test(source) ||
      /[$`*?{}\\\s]|:\/\//.test(source) ||
      path.posix.normalize(source).startsWith("../")
    ) {
      continue;
    }
    let archive = resolveDockerStagePath(copy.destination, entry.workdir, entry.environment);
    if (!archive) {
      continue;
    }
    if (
      copy.destination.endsWith("/") ||
      copy.destination === "." ||
      entry.directories.has(archive)
    ) {
      archive = path.posix.join(archive, path.posix.basename(source));
    }
    const following = stage.entries.slice(index + 1);
    const nextIndex = following.findIndex(
      ({ instruction }) =>
        !/^(?:WORKDIR|ENV|USER|LABEL)$/.test(dockerInstructionKeyword(instruction)),
    );
    const next = following[nextIndex];
    if (
      !next ||
      dockerInstructionKeyword(next.instruction) !== "RUN" ||
      next.instruction.flags?.length
    ) {
      continue;
    }
    const extract = extractionRun(next, archive);
    if (!extract) {
      continue;
    }
    let cleanupLine: number | undefined = extract.cleaned ? next.instruction.startLine : undefined;
    if (!extract.cleaned) {
      const cleanup = following
        .slice(nextIndex + 1)
        .find(
          ({ instruction }) =>
            !/^(?:WORKDIR|ENV|USER|LABEL)$/.test(dockerInstructionKeyword(instruction)),
        );
      const commands =
        cleanup && !cleanup.instruction.flags?.length ? archiveRunCommands(cleanup) : [];
      if (cleanup && commands.length === 1 && removesArchive(commands[0]!, archive, cleanup)) {
        cleanupLine = cleanup.instruction.startLine;
      } else if (
        !context ||
        !archiveHasOnlyArtifactExports(
          stage,
          index + 1 + nextIndex,
          archive,
          extract.directory,
          context,
        )
      ) {
        continue;
      }
    }
    results.push({
      source,
      archive,
      directory: extract.directory,
      copyLine: entry.instruction.startLine,
      extractLine: next.instruction.startLine,
      cleanupLine,
      mountTarget: pathWithinSourceBind(archive, extract.directory)
        ? `/__ci_perf_lint_archive_${entry.instruction.startLine}.input`
        : archive,
    });
  }
  return results;
}
