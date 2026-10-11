import path from "node:path";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import {
  parseDockerfileCopyInstruction,
  parseDockerfileFromInstruction,
} from "./dockerfile-instructions.ts";
import type { DockerInstallContextProbes } from "./docker-install-context-probes.ts";
import {
  pathWithinSourceBind,
  resolveSourceBindPath,
  sourceBindBuild,
  sourceBindSuppliesRegion,
  type SourceBindBuild,
} from "./docker-source-bind-commands.ts";

interface Entry {
  instruction: CollectedDockerfileInstruction;
  workdir?: string;
}
interface Stage {
  index: number;
  alias?: string;
  parent?: Stage;
  entries: Entry[];
  workdir?: string;
}
interface Candidate {
  copy: Entry;
  build: Entry;
  source: string;
  destination: string;
  compilation: SourceBindBuild;
}

function keyword(instruction: CollectedDockerfileInstruction): string {
  return (
    instruction.keyword?.toUpperCase() ?? instruction.text.match(/^\w+/)?.[0]?.toUpperCase() ?? ""
  );
}

function fromFlag(instruction: CollectedDockerfileInstruction): string | undefined {
  return instruction.flags?.find((flag) => flag.name.toLowerCase() === "from")?.value ?? undefined;
}

function collectStages(instructions: CollectedDockerfileInstruction[]): Stage[] {
  const stages: Stage[] = [];
  const aliases = new Map<string, Stage>();
  for (const instruction of instructions) {
    if (keyword(instruction) === "FROM") {
      const image = parseDockerfileFromInstruction(instruction)?.image;
      const parent = image ? aliases.get(image.toLowerCase()) : undefined;
      const alias = (instruction.argumentsContent ?? instruction.text)
        .match(/\bAS\s+(\S+)\s*$/i)?.[1]
        ?.toLowerCase();
      const stage: Stage = {
        index: stages.length,
        alias,
        parent,
        entries: [],
        workdir: parent?.workdir,
      };
      stages.push(stage);
      if (alias) {
        aliases.set(alias, stage);
      }
      aliases.set(String(stage.index), stage);
      continue;
    }
    const stage = stages.at(-1);
    if (!stage) {
      continue;
    }
    if (keyword(instruction) === "WORKDIR") {
      const value = instruction.argumentsContent ?? instruction.text.replace(/^WORKDIR\s+/i, "");
      stage.workdir = resolveSourceBindPath(value.trim(), stage.workdir);
    }
    stage.entries.push({ instruction, workdir: stage.workdir });
  }
  return stages;
}

function sourceCopy(entry: Entry): { source: string; destination: string } | undefined {
  if (!entry.workdir || entry.instruction.flags?.length) {
    return undefined;
  }
  const copy = parseDockerfileCopyInstruction(entry.instruction);
  if (copy?.sources.length !== 1) {
    return undefined;
  }
  const source = (copy.sources[0] ?? "").replace(/^\.\//, "").replace(/\/$/, "") || ".";
  if (source !== "." && !/^src(?:\/(?:main|test)(?:\/(?:java|kotlin|resources))?)?$/.test(source)) {
    return undefined;
  }
  const destination = resolveSourceBindPath(copy.destination, entry.workdir);
  if (!destination || destination === "/") {
    return undefined;
  }
  return { source, destination };
}

function safePrefix(stage: Stage, copyIndex: number): boolean {
  if (stage.parent?.parent) {
    return false;
  }
  const entries = [...(stage.parent?.entries ?? []), ...stage.entries.slice(0, copyIndex)];
  return entries.every(({ instruction }) => {
    if (keyword(instruction) !== "RUN") {
      return true;
    }
    // Only known dependency steps; earlier opaque RUNs may generate inputs.
    if (/[;&|]/.test(instruction.text)) {
      return false;
    }
    return /^RUN\s+(?:--mount=\S+\s+)*(?:go\s+mod\s+download|cargo\s+fetch|(?:mvn|\.\/mvnw)\s+dependency:go-offline|(?:gradle|\.\/gradlew)\s+dependencies)\b/i.test(
      instruction.text,
    );
  });
}

function findCandidate(stage: Stage, probes: DockerInstallContextProbes): Candidate | undefined {
  for (const [copyIndex, copy] of stage.entries.entries()) {
    const region = sourceCopy(copy);
    if (!region || !safePrefix(stage, copyIndex)) {
      continue;
    }
    const following = stage.entries.slice(copyIndex + 1);
    const buildIndex = following.findIndex(({ instruction }) => keyword(instruction) === "RUN");
    const build = following[buildIndex];
    if (!build || build.workdir !== copy.workdir) {
      continue;
    }
    const compilation = sourceBindBuild(build.instruction, build.workdir, probes);
    if (
      !compilation ||
      compilation.outputs.some((output) => pathWithinSourceBind(output, region.destination))
    ) {
      continue;
    }
    const java = compilation.language.startsWith("Java");
    if (
      java
        ? region.source === "." ||
          region.destination !== path.posix.join(copy.workdir!, region.source)
        : region.source !== "." || region.destination !== copy.workdir
    ) {
      continue;
    }
    if (sourceBindSuppliesRegion(build.instruction, region.destination, copy.workdir!)) {
      continue;
    }
    if (following.slice(buildIndex + 1).some(({ instruction }) => keyword(instruction) === "RUN")) {
      continue;
    }
    // A source bind must not hide stage-generated inputs or metadata changes.
    const otherCopies = [...(stage.parent?.entries ?? []), ...stage.entries].filter(
      (entry) =>
        entry !== copy &&
        (keyword(entry.instruction) === "COPY" || keyword(entry.instruction) === "ADD"),
    );
    if (
      otherCopies.some((entry) => {
        const other = parseDockerfileCopyInstruction(entry.instruction);
        if (!other) {
          return true;
        }
        const destination = resolveSourceBindPath(other.destination, entry.workdir);
        if (!destination) {
          return true;
        }
        const overlaps =
          pathWithinSourceBind(destination, region.destination) ||
          pathWithinSourceBind(region.destination, destination);
        return (
          overlaps &&
          (stage.entries.indexOf(entry) > copyIndex ||
            fromFlag(entry.instruction) !== undefined ||
            !!entry.instruction.flags?.length)
        );
      })
    ) {
      continue;
    }
    if (
      stage.entries.some(({ instruction }) =>
        /(?:GOFLAGS.*-mod=mod|go\s+generate|\btouch\b|\bsed\s+-i\b)/.test(instruction.text),
      )
    ) {
      continue;
    }
    return { copy, build, ...region, compilation };
  }
  return undefined;
}

function artifactExport(source: string, candidate: Candidate): boolean {
  const resolved = resolveSourceBindPath(source, undefined, true);
  if (!resolved) {
    return false;
  }
  if (!candidate.compilation.directories) {
    return candidate.compilation.outputs.includes(resolved);
  }
  if (
    !candidate.compilation.outputs.some(
      (output) => resolved !== output && pathWithinSourceBind(resolved, output),
    )
  ) {
    return false;
  }
  return candidate.compilation.language.startsWith("Java")
    ? /\.(?:jar|war)$/.test(resolved)
    : !/[[*\]]/.test(resolved);
}

export function findSourceBindCandidate(
  instructions: CollectedDockerfileInstruction[],
  probes: DockerInstallContextProbes,
) {
  const stages = collectStages(instructions);
  for (const stage of stages) {
    const candidate = findCandidate(stage, probes);
    if (!candidate || stages.some((other) => other.parent === stage)) {
      continue;
    }
    const selectors = new Set([String(stage.index), ...(stage.alias ? [stage.alias] : [])]);
    let exports = 0;
    let unsafe = false;
    for (const other of stages) {
      for (const { instruction } of other.entries) {
        const selector = fromFlag(instruction)?.toLowerCase();
        if (selector?.includes("$")) {
          unsafe = true;
        }
        if (selector && selectors.has(selector)) {
          if (other === stage) {
            unsafe = true;
          }
          const copy = parseDockerfileCopyInstruction(instruction);
          if (!copy || !copy.sources.every((source) => artifactExport(source, candidate))) {
            unsafe = true;
          } else {
            exports++;
          }
        }
        if (
          keyword(instruction) === "RUN" &&
          instruction.flags?.some((flag) => {
            if (flag.name.toLowerCase() !== "mount") {
              return false;
            }
            const from = flag.value
              ?.split(",")
              .find((part) => /^from=/i.test(part))
              ?.slice(5)
              .replace(/^['"]|['"]$/g, "")
              .toLowerCase();
            return !!from && (from.includes("$") || selectors.has(from));
          })
        ) {
          unsafe = true;
        }
      }
    }
    if (exports > 0 && !unsafe) {
      return candidate;
    }
  }
  return undefined;
}
