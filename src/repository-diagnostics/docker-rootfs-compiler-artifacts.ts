import path from "node:path";
import { parseDockerfileCopyInstruction } from "./dockerfile-instructions.ts";
import type { DockerBuildStage, DockerStageEntry } from "./docker-build-stage-context.ts";
import { dockerInstructionKeyword, dockerStageAncestry } from "./docker-build-stage-context.ts";
import { directCommand, dockerRunCommands } from "./docker-image-metadata-helpers.ts";
import { pathWithinSourceBind } from "./docker-source-bind-commands.ts";
import { resolveDockerStagePath } from "./docker-stage-paths.ts";

interface Artifact {
  path: string;
  line: number;
}

function defaultGoOutput(
  args: string[],
  entry: DockerStageEntry,
  module: string | undefined,
  moduleRoots: Set<string>,
): string | undefined {
  if (!module || !entry.workdir || !moduleRoots.has(entry.workdir) || /\/v\d+$/.test(module)) {
    return undefined;
  }
  if (
    entry.environment.get("GOFLAGS") ||
    (entry.environment.get("GOWORK") && entry.environment.get("GOWORK") !== "off") ||
    (entry.environment.get("GOENV") && entry.environment.get("GOENV") !== "off")
  ) {
    return undefined;
  }
  const packages: string[] = [];
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    if (/^(?:-v|-x|-a|-race|-trimpath|-buildvcs=(?:true|false))$/.test(arg)) {
      continue;
    }
    if (/^-(?:ldflags|gcflags|asmflags|tags)(?:=|$)/.test(arg)) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++index];
      if (!value || /(?:^|\s)-o(?:\s|=)/.test(value)) {
        return undefined;
      }
    } else if (arg === ".") {
      packages.push(arg);
    } else {
      return undefined;
    }
  }
  if (packages.length > 1) {
    return undefined;
  }
  return path.posix.join(entry.workdir, path.posix.basename(module));
}

function compiledOutput(
  tokens: string[],
  entry: DockerStageEntry,
  compiler: "go" | "rustc",
  module: string | undefined,
  moduleRoots: Set<string>,
) {
  const command = directCommand(tokens);
  if (
    command.name !== compiler ||
    (compiler === "go" && command.args[0] !== "build") ||
    command.args.some((arg) => /^(?:--help|-h|--version|-buildmode=(?!exe$|pie$))/.test(arg))
  ) {
    return undefined;
  }
  const mode = command.args.indexOf("-buildmode");
  if (mode >= 0 && !["exe", "pie"].includes(command.args[mode + 1] ?? "")) {
    return undefined;
  }
  const outputIndex = command.args.indexOf("-o");
  const output =
    outputIndex >= 0
      ? command.args[outputIndex + 1]
      : command.args.find((arg) => arg.startsWith("-o="))?.slice(3);
  if (output !== undefined) {
    return !output.endsWith("/")
      ? resolveDockerStagePath(output, entry.workdir, entry.environment)
      : undefined;
  }
  return compiler === "go" ? defaultGoOutput(command.args, entry, module, moduleRoots) : undefined;
}

export function findRetainedCompilerArtifacts(
  stages: readonly DockerBuildStage[],
  source: DockerBuildStage,
  goMainModule?: string,
) {
  const compiler = source.compiler;
  if (!compiler) {
    return undefined;
  }
  const artifacts = new Map<string, Artifact>();
  const moduleRoots = new Set<string>();
  const compilerDirectory = compiler === "go" ? "/usr/local/go" : "/usr/local/rustup";
  for (const stage of dockerStageAncestry(stages, source)) {
    for (const entry of stage.entries) {
      const keyword = dockerInstructionKeyword(entry.instruction);
      if (keyword === "COPY" || keyword === "ADD") {
        if (artifacts.size) {
          return undefined;
        }
        const copy = parseDockerfileCopyInstruction(entry.instruction);
        if (
          copy &&
          !entry.instruction.flags?.some((flag) => flag.name.toLowerCase() === "from") &&
          copy.sources.some((value) => value === "." || value === "./" || value === "go.mod")
        ) {
          const destination = resolveDockerStagePath(
            copy.destination,
            entry.workdir,
            entry.environment,
          );
          if (
            destination &&
            (copy.sources.includes(".") ||
              copy.sources.includes("./") ||
              copy.destination.endsWith("/") ||
              entry.directories.has(destination))
          ) {
            moduleRoots.add(destination);
          }
        }
      }
      if (keyword !== "RUN") {
        continue;
      }
      const commands = dockerRunCommands(entry.instruction);
      if (!commands.length) {
        if (artifacts.size) {
          return undefined;
        }
        moduleRoots.clear();
      }
      for (const tokens of commands) {
        const command = directCommand(tokens);
        const output = compiledOutput(tokens, entry, compiler, goMainModule, moduleRoots);
        if (output) {
          artifacts.set(output, { path: output, line: entry.instruction.startLine });
        } else if (command.name === "cp" && command.args.length === 2) {
          const input = resolveDockerStagePath(command.args[0]!, entry.workdir, entry.environment);
          const artifact = input ? artifacts.get(input) : undefined;
          let destination = resolveDockerStagePath(
            command.args[1]!,
            entry.workdir,
            entry.environment,
          );
          if (!artifact || !destination) {
            if (artifacts.size) {
              return undefined;
            }
            moduleRoots.clear();
            continue;
          }
          if (command.args[1]!.endsWith("/") || entry.directories.has(destination)) {
            destination = path.posix.join(destination, path.posix.basename(artifact.path));
          }
          artifacts.set(destination, { ...artifact, path: destination });
        } else if (command.name === "rm") {
          for (const arg of command.args.filter((value) => !value.startsWith("-"))) {
            const removed = resolveDockerStagePath(
              arg.endsWith("/*") ? arg.slice(0, -2) : arg,
              entry.workdir,
              entry.environment,
            );
            if (!removed) {
              return undefined;
            }
            if (
              pathWithinSourceBind(compilerDirectory, removed) ||
              pathWithinSourceBind(removed, compilerDirectory)
            ) {
              return undefined;
            }
            for (const file of artifacts.keys()) {
              if (pathWithinSourceBind(file, removed)) {
                artifacts.delete(file);
              }
            }
            for (const directory of moduleRoots) {
              if (pathWithinSourceBind(directory, removed)) {
                moduleRoots.delete(directory);
              }
            }
          }
        } else if (
          command.name !== "mkdir" &&
          !(command.name === "go" && command.args[0] === "mod" && command.args[1] === "download")
        ) {
          if (artifacts.size) {
            return undefined;
          }
          moduleRoots.clear();
        }
      }
    }
  }
  return artifacts.size ? { compiler, artifacts: [...artifacts.values()] } : undefined;
}
